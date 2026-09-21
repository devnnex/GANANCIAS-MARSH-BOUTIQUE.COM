 
const API = "https://script.google.com/macros/s/AKfycbzDFG8R-elR_nc1E3lSW6xd6hIpMHE2RKaC9bRiiR5i-ROJgyMiPdFfeM5pAmsBYhct/exec";
const STORE_API = "https://script.google.com/macros/s/AKfycbzi8L_mvDiOIQmicjbzPGWLFoKVL54snEi0T7Ng6bq_yPI_S85JvckhLde6SZEk12NLZw/exec";



// if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
//   document.body.classList.add("safari");
// }


/* ================================================================================================================================================================================================================================================================================================================================================================
  COMIENZO DE LA SECCION DE ANALISIS
==================================================================================================================================================================================================================================================================================================================================================================  */
// aqui empieza el desarrollo de la seccion de Analisis 🔹
const ANALYSIS_STATE = {
  month: new Date().getMonth(),
  year: new Date().getFullYear()
};

const KPI_CACHE_TTL = 3000;
const KPI_REFRESH_INTERVAL = 3000;
const INVENTORY_CACHE_TTL = 3000;
const STORE_SNAPSHOT_CACHE_KEY = "marsh-analysis-live-snapshot-v1";
const EXPENSE_STATE_KEY = "marsh-expenses-v1";
const EXPENSE_REMOVAL_MAX_AGE = 10 * 60 * 1000;
const STORE_SNAPSHOT_MAX_AGE = 24 * 60 * 60 * 1000;
const kpiCache = new Map();
const kpiAnimations = new Map();
let activeKpiRequest = null;
let kpiRequestSequence = 0;
let latestStoreSnapshot = null;
let lastKnownExpensesTotal = 0;
function restoreExpenseState() {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPENSE_STATE_KEY) || "null");
    if (!saved || !Array.isArray(saved.expenses)) throw new Error("No expense cache");
    return {
      expenses: saved.expenses.filter(item => item && item.id != null && item.nombre && toStoreNumber(item.valor) > 0),
      deletedIds: Array.isArray(saved.deletedIds) ? saved.deletedIds : [],
      pendingRemovals: Array.isArray(saved.pendingRemovals)
        ? saved.pendingRemovals.filter(item => Date.now() - Number(item.createdAt) < EXPENSE_REMOVAL_MAX_AGE)
        : []
    };
  } catch (_) {
    return { expenses: [], deletedIds: [], pendingRemovals: [] };
  }
}

const savedExpenseState = restoreExpenseState();
let expenses = savedExpenseState.expenses;
const deletedExpenseIds = new Set(savedExpenseState.deletedIds.map(String));
let pendingExpenseRemovals = savedExpenseState.pendingRemovals;
lastKnownExpensesTotal = expenses.reduce((sum, item) => sum + toStoreNumber(item.valor), 0);

function persistExpenseState() {
  try {
    localStorage.setItem(EXPENSE_STATE_KEY, JSON.stringify({
      expenses,
      deletedIds: [...deletedExpenseIds],
      pendingRemovals: pendingExpenseRemovals
    }));
  } catch (err) {
    console.error("No fue posible guardar los gastos en este navegador:", err);
  }
}

// MANEJAR CAMBIO DE MES Y POBLAR EL SELECTOR
const monthSelect = document.getElementById("analysisMonth");

const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
];

monthNames.forEach((name, index) => {
  const opt = document.createElement("option");
  opt.value = index;
  opt.textContent = name;
  if (index === ANALYSIS_STATE.month) opt.selected = true;
  monthSelect.appendChild(opt);
});

// MANEJAR CAMBIO DE AÑO Y POBLAR EL SELECTOR
const yearSelect = document.getElementById("analysisYear");
const currentYear = new Date().getFullYear();
let firstAvailableYear = currentYear - 5;
let lastAvailableYear = currentYear + 5;

function populateYearSelect() {
  const selectedYear = ANALYSIS_STATE.year;
  yearSelect.innerHTML = "";

  for (let y = firstAvailableYear; y <= lastAvailableYear; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === selectedYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

// Llenado inicial
populateYearSelect();

// ESCUCHAR CAMBIOS EN SELECTORES
monthSelect.addEventListener("change", e => {
  ANALYSIS_STATE.month = Number(e.target.value);
  fetchData();
  if (topProductsChart) loadTopProductsChart();
});

yearSelect.addEventListener("change", e => {
  const selectedYear = Number(e.target.value);
  ANALYSIS_STATE.year = selectedYear;

  if (selectedYear === lastAvailableYear) {
    lastAvailableYear += 5;
    populateYearSelect();
    yearSelect.value = String(selectedYear);
  }

  fetchData().finally(() => {
    loadSalesByMonthChart();
    loadTopProductsChart();
  });
});



// Variables globales para gráficos
let salesByMonthChart = null;
let topProductsChart = null;



// 🔹 Función para obtener los KPIs y top productos
function getPeriodKey(month, year) {
  return `${year}-${month}`;
}

function isFuturePeriod(month, year) {
  const today = new Date();
  return year > today.getFullYear() ||
    (year === today.getFullYear() && month > today.getMonth());
}

function toStoreNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return Number(String(value ?? "0").replace(/[^\d.-]/g, "")) || 0;
}

function normalizeStoreText(value) {
  return String(value || "").trim().toLocaleLowerCase("es-CO");
}

function parseStoreSaleDate(fecha) {
  if (!fecha) return null;

  const directDate = new Date(fecha);
  if (!Number.isNaN(directDate.getTime()) && /[T/-]/.test(String(fecha))) {
    return directDate;
  }

  const months = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
  };
  const parts = String(fecha).trim().toLocaleLowerCase("es-CO").split(/\s+/);
  const monthIndex = parts.findIndex(part =>
    Object.prototype.hasOwnProperty.call(months, part)
  );
  if (monthIndex < 1) return null;

  const day = Number(parts[monthIndex - 1]);
  const year = Number(parts[monthIndex + 1]);
  if (!day || !year) return null;
  return new Date(year, months[parts[monthIndex]], day);
}

function buildInventoryIndex(inventory) {
  const byId = new Map();
  const byNameAndBrand = new Map();

  (Array.isArray(inventory) ? inventory : []).forEach(product => {
    if (product.id != null) byId.set(String(product.id), product);
    const key = `${normalizeStoreText(product.nombre)}|${normalizeStoreText(product.marca)}`;
    byNameAndBrand.set(key, product);
  });

  return { byId, byNameAndBrand };
}

function getSaleCost(sale, inventoryIndex) {
  const quantity = Math.max(toStoreNumber(sale.cantidad), 0);
  const explicitTotal = [
    sale.costoTotal, sale.totalCosto, sale.costo_total, sale.inversion
  ].map(toStoreNumber).find(value => value > 0);
  if (explicitTotal) return explicitTotal;

  const explicitUnit = [sale.costoUnitario, sale.costo_unitario, sale.costo]
    .map(toStoreNumber)
    .find(value => value > 0);
  if (explicitUnit) return explicitUnit * quantity;

  const key = `${normalizeStoreText(sale.producto)}|${normalizeStoreText(sale.marca)}`;
  const product = inventoryIndex.byId.get(String(sale.productoId ?? sale.idProducto ?? "")) ||
    inventoryIndex.byNameAndBrand.get(key);
  const inventoryUnitCost = toStoreNumber(product?.costo);
  if (inventoryUnitCost > 0) return inventoryUnitCost * quantity;

  const explicitProfit = toStoreNumber(sale.ganancia);
  const total = toStoreNumber(sale.total);
  if (explicitProfit > 0 && total >= explicitProfit) return total - explicitProfit;

  // Respaldo para ventas antiguas que no guardaron el costo; el margen inicial era 100%.
  return toStoreNumber(sale.subtotal || sale.total) / 2;
}

function buildLiveKpiData(sales, inventory, month, year) {
  const inventoryIndex = buildInventoryIndex(inventory);
  const periodSales = (Array.isArray(sales) ? sales : []).filter(sale => {
    const date = parseStoreSaleDate(sale.fecha);
    return date && date.getMonth() === month && date.getFullYear() === year;
  });

  let totalVentas = 0;
  let totalDescuentos = 0;
  let totalCostos = 0;
  const products = new Map();

  periodSales.forEach(sale => {
    const total = toStoreNumber(sale.total);
    const discount = toStoreNumber(sale.descuento);
    const cost = getSaleCost(sale, inventoryIndex);
    const quantity = toStoreNumber(sale.cantidad);
    const productKey = `${normalizeStoreText(sale.producto)}|${normalizeStoreText(sale.marca)}`;
    const current = products.get(productKey) || {
      producto: sale.producto || "Producto",
      marca: sale.marca || "Sin marca",
      cantidad: 0,
      ganancia: 0
    };

    totalVentas += total;
    totalDescuentos += discount;
    totalCostos += cost;
    current.cantidad += quantity;
    current.ganancia += total - cost;
    products.set(productKey, current);
  });

  const gananciaConDescuento = totalVentas - totalCostos;
  return {
    success: true,
    totalVentas,
    totalDescuentos,
    ventasSinDescuento: totalCostos,
    gananciaConDescuento,
    gananciaNeta: gananciaConDescuento - lastKnownExpensesTotal,
    totalGastos: lastKnownExpensesTotal,
    topProductos: [...products.values()]
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10)
  };
}

function getSalesFingerprint(sales) {
  return (Array.isArray(sales) ? sales : [])
    .map(sale => [sale.id, sale.total, sale.cantidad, sale.descuento, sale.fecha, sale.hora].join("|"))
    .sort()
    .join(";");
}

function getInventoryFingerprint(inventory) {
  return (Array.isArray(inventory) ? inventory : [])
    .map(product => [
      product.id,
      product.nombre,
      product.marca,
      product.costo,
      product.stock,
      product.vendidos
    ].join("|"))
    .sort()
    .join(";");
}

function restoreStoreSnapshot() {
  try {
    if (typeof localStorage === "undefined") return null;
    const cached = JSON.parse(localStorage.getItem(STORE_SNAPSHOT_CACHE_KEY) || "null");
    if (!cached || !Array.isArray(cached.sales) || !Array.isArray(cached.inventory)) return null;
    if (Date.now() - Number(cached.updatedAt || 0) > STORE_SNAPSHOT_MAX_AGE) return null;

    return {
      sales: cached.sales,
      inventory: cached.inventory,
      salesFingerprint: getSalesFingerprint(cached.sales),
      inventoryFingerprint: getInventoryFingerprint(cached.inventory),
      updatedAt: Number(cached.updatedAt || 0),
      inventoryUpdatedAt: Number(cached.inventoryUpdatedAt || cached.updatedAt || 0)
    };
  } catch (err) {
    console.warn("No se pudo recuperar la última sincronización:", err);
    return null;
  }
}

function persistStoreSnapshot(snapshot) {
  try {
    if (typeof localStorage === "undefined" || !snapshot) return;
    localStorage.setItem(STORE_SNAPSHOT_CACHE_KEY, JSON.stringify({
      sales: snapshot.sales,
      inventory: snapshot.inventory,
      updatedAt: snapshot.updatedAt,
      inventoryUpdatedAt: snapshot.inventoryUpdatedAt
    }));
  } catch (err) {
    console.warn("No se pudo guardar la última sincronización:", err);
  }
}

function setKpiUpdating(isUpdating) {
  const grid = document.querySelector(".analysis-grid");
  if (!grid) return;
  grid.classList.toggle("is-updating", isUpdating);
  grid.setAttribute("aria-busy", String(isUpdating));
}

function setKpiPeriodMessage(message = "") {
  document.querySelectorAll(".analysis-grid .kpi-period-status").forEach(el => {
    el.textContent = message;
    el.hidden = !message;
  });
}

function renderKpiValues(data, periodMessage = "") {
  const safeData = data || {};

  animateNumber("kpiVentas", Number(safeData.totalVentas || 0));
  animateNumber("kpiGanancia", Number(safeData.gananciaNeta || 0));
  animateNumber("kpiDescuentos", Number(safeData.totalDescuentos || 0));
  animateNumber("kpiSinDescuento", Number(safeData.ventasSinDescuento || 0));
  animateNumber("ganancia_neta", Number(safeData.gananciaNeta || 0));

  document.getElementById("totalpagado").textContent =
    "$" + Number(safeData.totalGastos || 0).toLocaleString("es-CO");

  setKpiPeriodMessage(periodMessage);

  const tbody = document.getElementById("top_productos");
  if (!tbody) return;

  tbody.innerHTML = "";
  (Array.isArray(safeData.topProductos) ? safeData.topProductos : []).forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.producto}</td>
      <td>${p.marca}</td>
      <td>${p.cantidad}</td>
      <td>$${Number(p.ganancia || 0).toLocaleString("es-CO")}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderKpiResponse(data) {
  const hasSales = Number(data.totalVentas || 0) > 0;
  renderKpiValues(
    data,
    hasSales ? "" : "No se registraron ventas en este período."
  );
}

// Obtiene un solo resultado vigente por periodo. Las respuestas anteriores se descartan.
async function fetchData({ force = false, background = false } = {}) {
  const month = ANALYSIS_STATE.month;
  const year = ANALYSIS_STATE.year;
  const periodKey = getPeriodKey(month, year);

  if (isFuturePeriod(month, year)) {
    renderKpiValues({}, "Este período aún no ha llegado.");
    setKpiUpdating(false);
    return;
  }

  if (latestStoreSnapshot) {
    const currentData = buildLiveKpiData(
      latestStoreSnapshot.sales,
      latestStoreSnapshot.inventory,
      month,
      year
    );
    kpiCache.set(periodKey, { data: currentData, updatedAt: latestStoreSnapshot.updatedAt });
    renderKpiResponse(currentData);

    if (!force && Date.now() - latestStoreSnapshot.updatedAt < KPI_CACHE_TTL) {
      setKpiUpdating(false);
      return currentData;
    }
  }

  // El mismo listado de ventas sirve para cualquier filtro; no se duplica la consulta.
  if (activeKpiRequest) return;

  const requestId = ++kpiRequestSequence;

  const controller = new AbortController();
  activeKpiRequest = controller;
  setKpiUpdating(true);

  try {
    const cacheBuster = Date.now();
    const refreshInventory = !latestStoreSnapshot ||
      Date.now() - latestStoreSnapshot.inventoryUpdatedAt >= INVENTORY_CACHE_TTL;

    const salesPromise = fetch(
      `${STORE_API}?action=sales&_=${cacheBuster}`,
      { signal: controller.signal, cache: "no-store" }
    ).then(async res => {
      if (!res.ok) throw new Error(`Ventas HTTP ${res.status}`);
      const sales = await res.json();
      if (!Array.isArray(sales)) throw new Error("Respuesta de ventas inválida");
      return sales;
    });

    const inventoryPromise = refreshInventory
      ? fetch(
          `${STORE_API}?action=list&_=${cacheBuster}`,
          { signal: controller.signal, cache: "no-store" }
        ).then(async res => {
          if (!res.ok) throw new Error(`Inventario HTTP ${res.status}`);
          const inventory = await res.json();
          return Array.isArray(inventory) ? inventory : [];
        }).catch(err => {
          if (err.name === "AbortError") throw err;
          console.warn("No se pudo refrescar el costo del inventario:", err);
          return latestStoreSnapshot?.inventory || [];
        })
      : Promise.resolve(latestStoreSnapshot.inventory);

    const [sales, inventory] = await Promise.all([salesPromise, inventoryPromise]);
    if (requestId !== kpiRequestSequence) return;

    const previousFingerprint = latestStoreSnapshot?.salesFingerprint || "";
    const previousInventoryFingerprint = latestStoreSnapshot?.inventoryFingerprint || "";
    const salesFingerprint = getSalesFingerprint(sales);
    const inventoryFingerprint = getInventoryFingerprint(inventory);
    const salesChanged = salesFingerprint !== previousFingerprint;
    const inventoryChanged = inventoryFingerprint !== previousInventoryFingerprint;
    const now = Date.now();

    latestStoreSnapshot = {
      sales,
      inventory,
      salesFingerprint,
      inventoryFingerprint,
      updatedAt: now,
      inventoryUpdatedAt: refreshInventory
        ? now
        : latestStoreSnapshot.inventoryUpdatedAt
    };
    persistStoreSnapshot(latestStoreSnapshot);

    const selectedMonth = ANALYSIS_STATE.month;
    const selectedYear = ANALYSIS_STATE.year;
    const selectedKey = getPeriodKey(selectedMonth, selectedYear);
    const data = buildLiveKpiData(sales, inventory, selectedMonth, selectedYear);

    kpiCache.set(selectedKey, { data, updatedAt: now });
    renderKpiResponse(data);

    if (salesChanged) {
      if (salesByMonthChart) loadSalesByMonthChart();
      if (topProductsChart) loadTopProductsChart();
    }
    if (salesChanged || inventoryChanged) {
      renderBrandAnalysis();
    }

    return data;
  } catch (err) {
    if (err.name !== "AbortError" && requestId === kpiRequestSequence) {
      console.error("Error actualizando KPIs:", err);
      if (!background) {
        setKpiPeriodMessage("No fue posible actualizar. Se conserva el último dato visible.");
        showToast("No fue posible actualizar los indicadores");
      }
    }
  } finally {
    if (requestId === kpiRequestSequence) {
      activeKpiRequest = null;
      setKpiUpdating(false);
    }
  }
}





function showToast(msg) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.background = "#111";
  toast.style.color = "#fff";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "8px";
  toast.style.fontSize = "0.85rem";
  toast.style.zIndex = 9999;
  toast.style.opacity = "0";
  toast.style.transition = "opacity .3s ease";

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = "1");

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}



// 🔹 Formato de números
function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO');
}

// 🔹 Animación tipo "baloto" para cada KPI
function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;

  const previousAnimation = kpiAnimations.get(id);
  if (previousAnimation) cancelAnimationFrame(previousAnimation);

  const safeTarget = Number(target || 0);
  const current = Number(el.getAttribute("data-current") || 0);
  const difference = safeTarget - current;

  if (difference === 0) {
    el.textContent = "$" + formatNumber(safeTarget);
    el.setAttribute("data-current", safeTarget);
    return;
  }

  const startedAt = performance.now();
  const duration = 520;

  function tick(now) {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(current + difference * eased);

    el.textContent = "$" + formatNumber(value);
    el.setAttribute("data-current", value);

    if (progress < 1) {
      kpiAnimations.set(id, requestAnimationFrame(tick));
    } else {
      el.textContent = "$" + formatNumber(safeTarget);
      el.setAttribute("data-current", safeTarget);
      kpiAnimations.delete(id);
    }
  }

  kpiAnimations.set(id, requestAnimationFrame(tick));
}


// Los gastos guardados por el usuario no se descartan por una lectura vacía o atrasada.
function updateExpenseKpis() {
  lastKnownExpensesTotal = expenses.reduce(
    (sum, expense) => sum + toStoreNumber(expense.valor),
    0
  );

  if (latestStoreSnapshot && !isFuturePeriod(ANALYSIS_STATE.month, ANALYSIS_STATE.year)) {
    renderKpiResponse(buildLiveKpiData(
      latestStoreSnapshot.sales,
      latestStoreSnapshot.inventory,
      ANALYSIS_STATE.month,
      ANALYSIS_STATE.year
    ));
    return;
  }

  // En la primera carga, fetchData usará el total local al terminar de cargar ventas.
  fetchData({ background: true });
}

function sendExpenseChange(action, payload) {
  return fetch(API, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload })
  });
}

function scheduleExpensesSync() {
  // Apps Script puede tardar unos instantes en reflejar el cambio guardado.
  window.setTimeout(fetchExpenses, 750);
  window.setTimeout(fetchExpenses, 3000);
}

function expenseMatches(left, right) {
  return String(left.nombre).trim() === String(right.nombre).trim() &&
    toStoreNumber(left.valor) === toStoreNumber(right.valor);
}

function rememberExpenseRemoval(expense) {
  pendingExpenseRemovals.push({
    nombre: expense.syncNombre ?? expense.nombre,
    valor: expense.syncValor ?? expense.valor,
    createdAt: Date.now()
  });
}

function newExpenseId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createExpenseButton(label, className, onClick, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function renderExpenses({ refreshKpis = true } = {}) {
  const list = document.getElementById("expenseList");
  if (!list) return;
  list.innerHTML = "";

  expenses.forEach(expense => {
    const li = document.createElement("li");
    li.className = "expense-item";
    li.dataset.expenseId = String(expense.id);

    const text = document.createElement("span");
    text.className = "expense-text";
    text.append(`${expense.nombre}: `);
    const value = document.createElement("span");
    value.className = "expense-value";
    value.textContent = `$${toStoreNumber(expense.valor).toLocaleString("es-CO")}`;
    text.appendChild(value);

    const actions = document.createElement("span");
    actions.className = "expense-actions";
    actions.append(
      createExpenseButton("Editar", "expense-edit", () => editExpense(expense), "Editar gasto"),
      createExpenseButton("Eliminar", "expense-delete", () => deleteExpense(expense), "Eliminar gasto")
    );

    li.append(text, actions);
    list.appendChild(li);
  });

  persistExpenseState();
  if (refreshKpis) updateExpenseKpis();
}

async function addExpense(event) {
  event.preventDefault();
  const nameInput = document.getElementById("gastoNombre");
  const valueInput = document.getElementById("gastoValor");
  const nombre = nameInput.value.trim();
  const valor = Number(valueInput.value);
  if (!nombre || !Number.isFinite(valor) || valor <= 0) {
    alert("Ingrese nombre y un valor mayor a cero para el gasto");
    return;
  }

  expenses.push({ id: newExpenseId(), nombre, valor, syncNombre: nombre, syncValor: valor });
  nameInput.value = "";
  valueInput.value = "";
  renderExpenses();

  try {
    await sendExpenseChange("add_expense", { nombre, valor });
    scheduleExpensesSync();
  } catch (err) {
    console.error("Error agregando gasto:", err);
    alert("El gasto quedó guardado en este navegador, pero no se pudo sincronizar con el servidor.");
  }
}



function editExpense(expense) {
  const list = document.getElementById("expenseList");
  const item = [...list.children].find(li => li.dataset.expenseId === String(expense.id));
  if (!item) return;

  item.innerHTML = "";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = expense.nombre;
  nameInput.className = "expense-edit-input";
  nameInput.setAttribute("aria-label", "Nombre del gasto");

  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.min = "0";
  valueInput.step = "1";
  valueInput.value = toStoreNumber(expense.valor);
  valueInput.className = "expense-edit-input expense-edit-value";
  valueInput.setAttribute("aria-label", "Valor del gasto");

  const actions = document.createElement("span");
  actions.className = "expense-actions";
  actions.append(
    createExpenseButton("Guardar", "expense-save", () => saveExpenseEdit(expense, nameInput, valueInput), "Guardar cambios"),
    createExpenseButton("Cancelar", "expense-cancel", renderExpenses, "Cancelar edición")
  );
  item.append(nameInput, valueInput, actions);
  nameInput.focus();
}

async function saveExpenseEdit(expense, nameInput, valueInput) {
  const nombre = nameInput.value.trim();
  const valor = Number(valueInput.value);
  if (!nombre || !Number.isFinite(valor) || valor <= 0) {
    alert("Ingrese nombre y un valor mayor a cero para el gasto");
    return;
  }

  if (nombre === expense.nombre && valor === toStoreNumber(expense.valor)) {
    renderExpenses();
    return;
  }

  if (expense.remoteId != null) {
    deletedExpenseIds.add(String(expense.remoteId));
  } else {
    rememberExpenseRemoval(expense);
  }
  expenses = expenses.map(item => item.id === expense.id ? {
    ...item, nombre, valor, remoteId: null, syncNombre: nombre, syncValor: valor
  } : item);
  renderExpenses();

  try {
    // El servicio actual edita mediante eliminación y nueva creación.
    if (expense.remoteId != null) {
      await sendExpenseChange("delete_expense", { id: expense.remoteId });
    }
    await sendExpenseChange("add_expense", { nombre, valor });
    scheduleExpensesSync();
  } catch (err) {
    console.error("Error editando gasto:", err);
    alert("El cambio quedó guardado en este navegador, pero no se pudo sincronizar con el servidor.");
  }
}

async function deleteExpense(expense) {
  if (!confirm("¿Eliminar este gasto?")) return;

  if (expense.remoteId != null) {
    deletedExpenseIds.add(String(expense.remoteId));
  } else {
    rememberExpenseRemoval(expense);
  }
  expenses = expenses.filter(item => item.id !== expense.id);
  renderExpenses();

  try {
    if (expense.remoteId != null) {
      await sendExpenseChange("delete_expense", { id: expense.remoteId });
    }
    scheduleExpensesSync();
  } catch (err) {
    console.error("Error eliminando gasto:", err);
    alert("El gasto se quitó de este navegador, pero no se pudo sincronizar con el servidor.");
  }
}

document.getElementById("expenseForm").addEventListener("submit", addExpense);

async function fetchExpenses() {
  try {
    const res = await fetch(`${API}?action=expenses&_=${Date.now()}`, { cache: "no-store" });
    const data = await res.json();
    if (!Array.isArray(data)) return;
    pendingExpenseRemovals = pendingExpenseRemovals.filter(item =>
      Date.now() - Number(item.createdAt) < EXPENSE_REMOVAL_MAX_AGE
    );
    for (const remote of data) {
      if (!remote || remote.id == null || !remote.nombre || !(toStoreNumber(remote.valor) > 0)) continue;
      const remoteId = String(remote.id);
      if (deletedExpenseIds.has(remoteId)) continue;
      if (expenses.some(item => String(item.remoteId ?? item.id) === remoteId)) continue;

      const pending = expenses.find(item => item.remoteId == null && expenseMatches(
        { nombre: item.syncNombre ?? item.nombre, valor: item.syncValor ?? item.valor }, remote
      ));
      if (pending) {
        pending.remoteId = remote.id;
        delete pending.syncNombre;
        delete pending.syncValor;
        continue;
      }

      const removalIndex = pendingExpenseRemovals.findIndex(item => expenseMatches(item, remote));
      if (removalIndex !== -1) {
        pendingExpenseRemovals.splice(removalIndex, 1);
        deletedExpenseIds.add(remoteId);
        sendExpenseChange("delete_expense", { id: remote.id }).catch(err =>
          console.error("Error sincronizando eliminación de gasto:", err)
        );
        continue;
      }

      expenses.push({ id: newExpenseId(), remoteId: remote.id, nombre: remote.nombre, valor: remote.valor });
    }
    renderExpenses();
  } catch (err) {
    console.error("Error obteniendo gastos:", err);
  }
}


function setTotalVentasAnio(total) {
  const card = document.querySelector(".chart-card");
  if (!card) return;

  const h3 = card.querySelector("h3");
  if (!h3) return;

  // Convertimos el h3 en contenedor flex
  h3.style.display = "flex";
  h3.style.justifyContent = "space-between";
  h3.style.alignItems = "center";
  h3.style.gap = "12px";

  // Texto izquierdo (Ventas por Mes)
  let title = h3.querySelector(".chart-title");
  if (!title) {
    title = document.createElement("span");
    title.className = "chart-title";
    title.textContent = h3.textContent.trim();
    h3.textContent = "";
    h3.appendChild(title);
  }

  // Bloque derecho (Ventas Año)
  let box = h3.querySelector(".ventas-anio-box");

  if (!box) {
    box = document.createElement("div");
    box.className = "ventas-anio-box";
    box.style.textAlign = "right";
    box.style.lineHeight = "1.1";

    const label = document.createElement("div");
    label.textContent = "Ventas Año";
    label.style.fontSize = "0.65rem";
    label.style.fontWeight = "500";
    label.style.opacity = "0.6";

    const value = document.createElement("div");
    value.className = "ventas-anio-value";
    value.style.fontSize = "0.85rem";
    value.style.fontWeight = "700";
    value.style.color = "#16a34a";

    box.appendChild(label);
    box.appendChild(value);
    h3.appendChild(box);
  }

  // Actualizar valor
  const valueEl = h3.querySelector(".ventas-anio-value");
  valueEl.textContent = `$${total.toLocaleString("es-CO")}`;
}



// 🔹 Cargar gráfico de ventas por mes
async function loadSalesByMonthChart() {
  const { year } = ANALYSIS_STATE; // Tomamos el año seleccionado
  const labels = [...monthNames];
  const monthlySales = Array(12).fill(0);

  (latestStoreSnapshot?.sales || []).forEach(sale => {
    const date = parseStoreSaleDate(sale.fecha);
    if (!date || date.getFullYear() !== year) return;
    monthlySales[date.getMonth()] += toStoreNumber(sale.total);
  });

  const totalAnual = monthlySales.reduce(
    (sum, val) => sum + Number(val || 0),
    0
  );

  setTotalVentasAnio(totalAnual); // Actualiza la tarjeta del total anual

  const ctx = document.getElementById("salesByMonthChart");

  if (salesByMonthChart) salesByMonthChart.destroy();

  salesByMonthChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `Ventas del Año ${year}`,
        data: monthlySales,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}




// 🔹 Cargar gráfico de top productos
async function loadTopProductsChart() {
  const data = buildLiveKpiData(
    latestStoreSnapshot?.sales || [],
    latestStoreSnapshot?.inventory || [],
    ANALYSIS_STATE.month,
    ANALYSIS_STATE.year
  ).topProductos;

  const ctx = document.getElementById("topProductsChart");

  if (topProductsChart) topProductsChart.destroy();

  topProductsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map(product => product.producto),
      datasets: [{
        label: "Cantidad Vendida",
        data: data.map(product => product.cantidad)
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

/* ======================
  MODAL DE MARCAS
====================== */
const brandModal = document.getElementById("brandModal");
const brandModalTitle = document.getElementById("brandModalTitle");
const brandProductsTableBody = document.querySelector("#brandProductsTable tbody");
const brandModalClose = document.getElementById("brandModalClose");

// Cerrar modal
brandModalClose.addEventListener("click", () => {
  brandModal.classList.add("hidden");
  brandProductsTableBody.innerHTML = "";
});

// Función para mostrar productos de una marca
async function showBrandProducts(marca) {
  brandModalTitle.textContent = `Productos de ${marca}`;

  let products = latestStoreSnapshot?.inventory || [];
  if (!products.length) {
    try {
      const res = await fetch(`${STORE_API}?action=list&_=${Date.now()}`, { cache: "no-store" });
      products = await res.json();
    } catch (err) {
      console.error("Error obteniendo productos de la marca:", err);
    }
  }

  const filtered = (Array.isArray(products) ? products : [])
    .filter(product => normalizeStoreText(product.marca) === normalizeStoreText(marca));
  brandProductsTableBody.innerHTML = "";

  filtered.forEach(product => {
    const totalInversion = toStoreNumber(product.costo) * toStoreNumber(product.stock);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${product.nombre}</td>
      <td>${product.stock}</td>
      <td>$${toStoreNumber(product.costo).toLocaleString("es-CO")}</td>
      <td>$${totalInversion.toLocaleString("es-CO")}</td>
    `;
    brandProductsTableBody.appendChild(tr);
  });

  brandModal.classList.remove("hidden");
}

// 🔹 Agregar evento click a cada marca en la tabla de análisis
document.querySelectorAll(".brand-analysis-card tbody tr td:first-child").forEach(td => {
  td.style.cursor = "pointer"; // indica que es clickeable
  td.addEventListener("click", () => {
    showBrandProducts(td.textContent);
  });
});


// 🔹 Cargar análisis por marca
async function renderBrandAnalysis() {
  const tbody = document.querySelector("#brandAnalysisTable tbody");
  if (!tbody) return;

  const inventory = latestStoreSnapshot?.inventory || [];
  const sales = latestStoreSnapshot?.sales || [];
  const inventoryIndex = buildInventoryIndex(inventory);
  const brands = new Map();

  inventory.forEach(product => {
    const key = normalizeStoreText(product.marca) || "sin marca";
    const current = brands.get(key) || {
      marca: product.marca || "Sin marca",
      productos: 0,
      vendidos: 0,
      inversion: 0,
      ventas: 0,
      ganancia: 0
    };
    current.productos += 1;
    current.inversion += toStoreNumber(product.costo) * toStoreNumber(product.stock);
    brands.set(key, current);
  });

  sales.forEach(sale => {
    const key = normalizeStoreText(sale.marca) || "sin marca";
    const current = brands.get(key) || {
      marca: sale.marca || "Sin marca",
      productos: 0,
      vendidos: 0,
      inversion: 0,
      ventas: 0,
      ganancia: 0
    };
    const total = toStoreNumber(sale.total);
    current.vendidos += toStoreNumber(sale.cantidad);
    current.ventas += total;
    current.ganancia += total - getSaleCost(sale, inventoryIndex);
    brands.set(key, current);
  });

  const data = [...brands.values()].sort((a, b) => b.ventas - a.ventas);
  tbody.innerHTML = "";

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6">No hay datos</td></tr>`;
    return;
  }

  data.forEach(brand => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${brand.marca}</td>
      <td>${brand.productos}</td>
      <td>${brand.vendidos}</td>
      <td>$${brand.inversion.toLocaleString("es-CO")}</td>
      <td>$${brand.ventas.toLocaleString("es-CO")}</td>
      <td>$${brand.ganancia.toLocaleString("es-CO")}</td>
    `;
    tr.querySelector("td:first-child").style.cursor = "pointer";
    tr.querySelector("td:first-child").addEventListener("click", () => {
      showBrandProducts(brand.marca);
    });
    tbody.appendChild(tr);
  });
}


// Gastos usan su backend administrativo; ventas y marcas se actualizan aparte en vivo.
setInterval(() => {
  if (activeKpiRequest) return;
  fetchExpenses();
}, 30000);

// Los KPIs se sincronizan sin competir con los cambios manuales de filtro.
setInterval(() => {
  if (document.visibilityState === "visible") {
    fetchData({ force: true, background: true });
  }
}, KPI_REFRESH_INTERVAL);

function syncNowWhenReturning() {
  if (document.visibilityState === "visible") {
    fetchData({ force: true, background: true });
  }
}

document.addEventListener("visibilitychange", syncNowWhenReturning);
window.addEventListener("focus", syncNowWhenReturning);
window.addEventListener("online", syncNowWhenReturning);


setInterval(() => {
  if (activeKpiRequest) return;
  loadSalesByMonthChart();
  loadTopProductsChart();
}, 120000);

// Primera carga: pinta la última sincronización al instante y valida el dato en vivo.
latestStoreSnapshot = restoreStoreSnapshot();
renderExpenses({ refreshKpis: false });
fetchData({ force: true, background: Boolean(latestStoreSnapshot) }).finally(() => {
  fetchExpenses();
  renderBrandAnalysis();
  loadSalesByMonthChart();
  loadTopProductsChart();
});
/* ================================================================================================================================================================================================================================================================================================================================================================
 FINAL DE LA SECCION DE ANALISIS
==================================================================================================================================================================================================================================================================================================================================================================  */






/* ======================================================================================================================
 COMIENZO DE LA SECCION DE CLIENTES
====================================================================================================================== */

// =======================
// CLIENTES EN MEMORIA (SESIÓN)
// =======================
let sessionClients = [];

// =======================
// FORMATO FECHAS
// =======================
function formatDateLong(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date)) return "";
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

// =======================
// RENDER CLIENTES
// =======================
async function renderClients() {
  try {
    const res = await fetch(API + "?action=list_clients");
    const data = await res.json();

    const tbody = document.querySelector("#clientsTable tbody");
    tbody.innerHTML = "";

    if (data.success && data.data.length) {
      sessionClients = data.data; // 🔥 guardamos en sesión

      data.data.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><input type="checkbox" data-id="${c.id}"></td>
          <td>${c.nombre}</td>
          <td>${c.telefono || ""}</td>
          <td>${c.correo || ""}</td>
          <td>${formatDateLong(c.fechacumple)}</td>
          <td>${formatDateLong(c.registrado)}</td>
          <td>
            <button class="edit-client" data-id="${c.id}">Editar</button>
            <button class="delete-client" data-id="${c.id}">Eliminar</button>
            <button class="email-client" data-id="${c.id}">📧</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      attachClientEvents();
      updateClientKPIs(sessionClients);
    } else {
      sessionClients = [];
      tbody.innerHTML = `<tr><td colspan="7">No hay clientes</td></tr>`;
      updateClientKPIs([]);
    }
  } catch (err) {
    console.error("Error cargando clientes:", err);
  }
}



/* =======================
   MODAL NUEVO CLIENTE
======================= */

const btnAddClient = document.getElementById("btnAddClient");
const clientModal = document.getElementById("clientModal");
const clientForm = document.getElementById("clientForm");

const clientName = document.getElementById("clientName");
const clientPhone = document.getElementById("clientPhone");
const clientEmail = document.getElementById("clientEmail");
const clientBirthday = document.getElementById("clientBirthday");
const clientId = document.getElementById("clientId");
const clientModalTitle = document.getElementById("clientModalTitle");
const clientModalClose = document.getElementById("clientModalClose");

/* ➕ ABRIR MODAL NUEVO CLIENTE */
btnAddClient.onclick = () => {
  clientModal.classList.remove("hidden");

  clientModalTitle.textContent = "Nuevo Cliente";

  clientForm.reset();
  clientId.value = ""; // 🔑 importante para que NO edite
};

/* ❌ CERRAR MODAL */
clientModalClose.onclick = () => {
  clientModal.classList.add("hidden");
};


/* =======================
   GUARDAR CLIENTE (CREATE / UPDATE)
======================= */

clientForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    nombre: clientName.value.trim(),
    telefono: clientPhone.value.trim(),
    correo: clientEmail.value.trim(),
    fechacumple: clientBirthday.value
  };

  // Validación mínima
  if (!payload.nombre) {
    return Swal.fire("Falta nombre", "El nombre es obligatorio", "warning");
  }

  let action = "create_client";

  // ✏️ EDITAR
  if (clientId.value) {
    payload.id = clientId.value;
    action = "update_client";
  }

  try {
    await fetch(API, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...payload
      })
    });

    clientModal.classList.add("hidden");
    clientForm.reset();
    clientId.value = "";

    renderClients(); // 🔄 refrescar tabla

    Swal.fire({
      icon: "success",
      title: action === "create_client"
        ? "Cliente registrado"
        : "Cliente actualizado",
      timer: 1600,
      showConfirmButton: false,
      background: "#111",
      color: "#fff"
    });

  } catch (err) {
    console.error("Error guardando cliente:", err);
    Swal.fire("Error", "No se pudo guardar el cliente", "error");
  }
});


// =======================
// KPIs CLIENTES
// =======================
function updateClientKPIs(clients) {
  const totalClientes = document.getElementById("totalClientes");
  const nextBirthdayInfo = document.getElementById("nextBirthdayInfo");
  const birthdaysThisMonth = document.getElementById("birthdaysThisMonth");
  const emailNextBirthday = document.getElementById("emailNextBirthday");

  if (!clients.length) {
    totalClientes.textContent = 0;
    nextBirthdayInfo.textContent = "—";
    birthdaysThisMonth.textContent = 0;
    emailNextBirthday.style.display = "none";
    return;
  }

  totalClientes.textContent = clients.length;

  const today = new Date();
  const upcoming = clients
    .filter(c => c.fechacumple)
    .map(c => {
      const b = new Date(c.fechacumple);
      const next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      return { ...c, nextBirthday: next };
    })
    .sort((a, b) => a.nextBirthday - b.nextBirthday);

  let index = 0;

  function renderBirthday(i) {
    const c = upcoming[i];
    const diff = Math.ceil((c.nextBirthday - today) / 86400000);

    nextBirthdayInfo.innerHTML = `
      <div class="birthday-name">${c.nombre}</div>
      <div class="birthday-date">${formatDateLong(c.fechacumple)}</div>
      <div class="birthday-days">En ${diff} días</div>
    `;

    emailNextBirthday.style.display = c.correo ? "inline-flex" : "none";
    emailNextBirthday.onclick = () => sendClientEmailForm(c);
  }

  renderBirthday(index);

  document.getElementById("prevBirthday").onclick = () => {
    index = (index - 1 + upcoming.length) % upcoming.length;
    renderBirthday(index);
  };

  document.getElementById("nextBirthday").onclick = () => {
    index = (index + 1) % upcoming.length;
    renderBirthday(index);
  };

  const month = today.getMonth();
  birthdaysThisMonth.textContent = clients.filter(c => {
    if (!c.fechacumple) return false;
    return new Date(c.fechacumple).getMonth() === month;
  }).length;
}

// =======================
// EVENTOS CLIENTES
// =======================
function attachClientEvents() {

  // EDITAR
  document.querySelectorAll(".edit-client").forEach(btn => {
    btn.onclick = () => {
      const c = sessionClients.find(x => x.id === btn.dataset.id);
      if (!c) return;

      clientModal.classList.remove("hidden");
      clientName.value = c.nombre;
      clientPhone.value = c.telefono || "";
      clientEmail.value = c.correo || "";
      clientBirthday.value = c.fechacumple || "";
      clientId.value = c.id;
    };
  });

  // ELIMINAR
 document.querySelectorAll(".delete-client").forEach(btn => {
  btn.onclick = async () => {

    const result = await Swal.fire({
      title: "🗑️ Eliminar cliente",
      text: "Esta acción no se puede deshacer",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",

      background: "#0b0b0b",
      color: "#ffffff",

      customClass: {
        popup: "neo-glass",
        title: "neo-title",
        confirmButton: "neo-confirm danger",
        cancelButton: "neo-cancel"
      },

      buttonsStyling: false
    });

    if (!result.isConfirmed) return;

    await fetch(API, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete_client",
        id: btn.dataset.id
      })
    });

    Swal.fire({
      icon: "success",
      title: "Cliente eliminado",
      timer: 1400,
      showConfirmButton: false,
      background: "#0b0b0b",
      color: "#fff",
      customClass: {
        popup: "neo-glass-success"
      }
    });

    renderClients();
  };
});


  // ENVIAR CORREO
  document.querySelectorAll(".email-client").forEach(btn => {
    btn.onclick = () => {
      const c = sessionClients.find(x => x.id === btn.dataset.id);
      if (!c || !c.correo) {
        return Swal.fire("Sin correo", "Este cliente no tiene correo", "warning");
      }

      Swal.fire({
        title: `¿Enviar correo a ${c.nombre}?`,
        confirmButtonText: "Enviar",
        showCancelButton: true,
        background: "#111",
        color: "#fff"
      }).then(r => r.isConfirmed && sendClientEmailForm(c));
    };
  });
}

// =======================
// EMAILJS
// =======================
function sendClientEmailForm(cliente) {
  if (!cliente?.correo) return;

  const EMAILJS_SERVICE_ID  = "service_ezqlbhb";
  const EMAILJS_TEMPLATE_ID = "template_w9sk5cf";

  /* ===== VARIABLES PARA EL TEMPLATE ===== */
  const templateParams = {
    to_name: cliente.nombre,
    email: cliente.correo, // 👈 debe coincidir con {{email}}
    telefono: cliente.telefono || "No registrado",
    fecha: new Date().toLocaleDateString("es-CO"),
    year: new Date().getFullYear()
  };

  /* ===== ENVÍO EMAILJS ===== */
  emailjs
    .send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      templateParams
    )
    .then(() => {
      Swal.fire({
        icon: "success",
        title: "Correo enviado",
        text: `Mensaje enviado a ${cliente.nombre}`,
        timer: 2500,
        showConfirmButton: false,
        background: "#111",
        color: "#fff"
      });
    })
    .catch((err) => {
      console.error("Error EmailJS:", err);
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "No se pudo enviar el correo",
        background: "#111",
        color: "#fff"
      });
    });
}

// =======================
// INICIALIZAR
// =======================
document.addEventListener("DOMContentLoaded", renderClients);





 

