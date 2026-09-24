 
const API = "https://script.google.com/macros/s/AKfycbw5S5WlEPIlmL16dPFyOlio51QvJGQOtP4jn5i2mFTPwkyNDRvHKeo5xHOFHk45QuYxlQ/exec";
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
  year: new Date().getFullYear(),
  range: "month"
};

const KPI_CACHE_TTL = 3000;
const KPI_REFRESH_INTERVAL = 3000;
const INVENTORY_CACHE_TTL = 3000;
const STORE_SNAPSHOT_CACHE_KEY = "marsh-analysis-live-snapshot-v1";
const EXPENSE_SYNC_INTERVAL = 2000;
const STORE_SNAPSHOT_MAX_AGE = 24 * 60 * 60 * 1000;
const kpiCache = new Map();
const kpiAnimations = new Map();
let activeKpiRequest = null;
let kpiRequestSequence = 0;
let latestStoreSnapshot = null;
let lastKnownExpensesTotal = 0;
let expenses = [];
let expenseRequestInFlight = false;
let expenseMutationCount = 0;
let lastExpenseFingerprint = "";
let lastExpensePeriodKey = "";

// MANEJAR CAMBIO DE MES Y POBLAR EL SELECTOR
const monthSelect = document.getElementById("analysisMonth");
const rangeSelect = document.getElementById("analysisRange");

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

function getAnalysisDateRange(
  range = ANALYSIS_STATE.range,
  month = ANALYSIS_STATE.month,
  year = ANALYSIS_STATE.year
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start;
  let end;

  if (range === "today") {
    start = new Date(today);
    end = new Date(today);
    end.setDate(end.getDate() + 1);
  } else if (range === "yesterday") {
    end = new Date(today);
    start = new Date(today);
    start.setDate(start.getDate() - 1);
  } else if (range === "last7" || range === "last15") {
    const days = range === "last7" ? 7 : 15;
    start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    end = new Date(today);
    end.setDate(end.getDate() + 1);
  } else {
    start = new Date(year, month, 1);
    end = new Date(year, month + 1, 1);
  }

  return { start, end };
}

function getAnalysisPeriodLabel() {
  if (ANALYSIS_STATE.range === "today") return "Hoy";
  if (ANALYSIS_STATE.range === "yesterday") return "Ayer";
  if (ANALYSIS_STATE.range === "last7") return "Últimos 7 días";
  if (ANALYSIS_STATE.range === "last15") return "Últimos 15 días";
  return `${monthNames[ANALYSIS_STATE.month]} ${ANALYSIS_STATE.year}`;
}

function updateAnalysisFilterUi() {
  const isMonth = ANALYSIS_STATE.range === "month";
  monthSelect.disabled = !isMonth;
  yearSelect.disabled = !isMonth;

  const label = getAnalysisPeriodLabel();
  const salesTitle = document.getElementById("kpiVentasTitle");
  const profitTitle = document.getElementById("kpiGananciaTitle");
  const discountsTitle = document.getElementById("kpiDescuentosTitle");
  const investmentTitle = document.getElementById("kpiInversionTitle");
  const expenseTitle = document.getElementById("expensePeriodTitle");
  if (salesTitle) salesTitle.textContent = `Ventas: ${label}`;
  if (profitTitle) profitTitle.textContent = `Ganancia con Descuentos: ${label}`;
  if (discountsTitle) discountsTitle.textContent = `Descuentos: ${label}`;
  if (investmentTitle) investmentTitle.textContent = `Sugerido a Invertir: ${label}`;
  if (expenseTitle) expenseTitle.textContent = `Gastos: ${label}`;
}

function refreshAnalysisPeriod({ refreshYearChart = false } = {}) {
  updateAnalysisFilterUi();
  fetchExpenses({ force: true });
  fetchData().finally(() => {
    if (refreshYearChart) loadSalesByMonthChart();
    loadTopProductsChart();
  });
}

// ESCUCHAR CAMBIOS EN SELECTORES
monthSelect.addEventListener("change", e => {
  ANALYSIS_STATE.month = Number(e.target.value);
  ANALYSIS_STATE.range = "month";
  rangeSelect.value = "month";
  refreshAnalysisPeriod();
});

yearSelect.addEventListener("change", e => {
  const selectedYear = Number(e.target.value);
  ANALYSIS_STATE.year = selectedYear;

  if (selectedYear === lastAvailableYear) {
    lastAvailableYear += 5;
    populateYearSelect();
    yearSelect.value = String(selectedYear);
  }

  ANALYSIS_STATE.range = "month";
  rangeSelect.value = "month";
  refreshAnalysisPeriod({ refreshYearChart: true });
});

rangeSelect.addEventListener("change", e => {
  ANALYSIS_STATE.range = e.target.value;
  if (ANALYSIS_STATE.range !== "month") {
    const now = new Date();
    ANALYSIS_STATE.month = now.getMonth();
    ANALYSIS_STATE.year = now.getFullYear();
    monthSelect.value = String(ANALYSIS_STATE.month);
    yearSelect.value = String(ANALYSIS_STATE.year);
  }
  refreshAnalysisPeriod();
});

updateAnalysisFilterUi();



// Variables globales para gráficos
let salesByMonthChart = null;
let topProductsChart = null;



// 🔹 Función para obtener los KPIs y top productos
function getPeriodKey(month, year, range = ANALYSIS_STATE.range) {
  const dates = getAnalysisDateRange(range, month, year);
  return `${range}-${dates.start.getTime()}-${dates.end.getTime()}`;
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

function buildLiveKpiData(sales, inventory, month, year, range = ANALYSIS_STATE.range) {
  const inventoryIndex = buildInventoryIndex(inventory);
  const dates = getAnalysisDateRange(range, month, year);
  const periodSales = (Array.isArray(sales) ? sales : []).filter(sale => {
    const date = parseStoreSaleDate(sale.fechaISO || sale.fecha);
    return date && date >= dates.start && date < dates.end;
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


// Apps Script es la fuente de verdad de los gastos en todos los dispositivos.
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

  // En la primera carga, fetchData usará el total recibido desde Apps Script.
  fetchData({ background: true });
}

async function sendExpenseChange(action, payload) {
  const params = new URLSearchParams({
    action,
    ...payload,
    _: Date.now().toString()
  });
  const response = await fetch(`${API}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Gastos HTTP ${response.status}`);

  const result = await response.json();
  if (!result || result.success !== true) {
    throw new Error(result?.message || "Apps Script no pudo guardar el gasto");
  }
  return result;
}

function newExpenseId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createExpenseButton(label, className, onClick, title, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function normalizeExpense(expense) {
  return {
    id: String(expense.id),
    nombre: String(expense.nombre || "").trim(),
    valor: toStoreNumber(expense.valor),
    fecha: expense.fecha || null,
    actualizado: expense.actualizado || null
  };
}

function getExpenseFingerprint(items) {
  return items
    .map(item => [item.id, item.nombre, toStoreNumber(item.valor), item.actualizado || item.fecha || ""].join("|"))
    .sort()
    .join(";");
}

function setExpenseFormBusy(isBusy) {
  const form = document.getElementById("expenseForm");
  if (!form) return;
  [...form.elements].forEach(element => {
    element.disabled = isBusy;
  });
  form.setAttribute("aria-busy", String(isBusy));
}

async function confirmExpenseAction(action, expense) {
  const isDelete = action === "delete";
  const title = isDelete ? "Eliminar gasto" : "Editar gasto";
  const text = isDelete
    ? `¿Confirma que desea eliminar "${expense.nombre}"?`
    : `¿Desea editar "${expense.nombre}"?`;

  if (typeof Swal !== "undefined") {
    const result = await Swal.fire({
      title,
      text,
      icon: isDelete ? "warning" : "question",
      showCancelButton: true,
      confirmButtonText: isDelete ? "Sí, eliminar" : "Sí, editar",
      cancelButtonText: "Cancelar",
      background: "#0b0b0b",
      color: "#ffffff",
      customClass: {
        popup: "neo-glass",
        title: "neo-title",
        confirmButton: isDelete ? "neo-confirm danger" : "neo-confirm",
        cancelButton: "neo-cancel"
      },
      buttonsStyling: false
    });
    return result.isConfirmed;
  }

  return confirm(text);
}

function getExpenseRenderSignature(expense) {
  return [expense.nombre, toStoreNumber(expense.valor), expense.pending ? "pending" : "saved"].join("|");
}

function createExpenseListItem(expense) {
  const li = document.createElement("li");
  li.className = "expense-item";
  li.dataset.expenseId = String(expense.id);
  li.dataset.expenseSignature = getExpenseRenderSignature(expense);

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
    createExpenseButton("Editar", "expense-edit", () => editExpense(expense), "Editar gasto", expense.pending),
    createExpenseButton("Eliminar", "expense-delete", () => deleteExpense(expense), "Eliminar gasto", expense.pending)
  );

  li.append(text, actions);
  return li;
}

function renderExpenses({ refreshKpis = true, forceIds = [] } = {}) {
  const list = document.getElementById("expenseList");
  if (!list) return;
  const forced = new Set(forceIds.map(String));
  const existing = new Map(
    [...list.children].map(item => [item.dataset.expenseId, item])
  );

  expenses.forEach((expense, index) => {
    const id = String(expense.id);
    const signature = getExpenseRenderSignature(expense);
    let item = existing.get(id);

    if (!item || item.dataset.expenseSignature !== signature || forced.has(id)) {
      const replacement = createExpenseListItem(expense);
      if (item) item.replaceWith(replacement);
      item = replacement;
    }

    const itemAtPosition = list.children[index];
    if (itemAtPosition !== item) {
      list.insertBefore(item, itemAtPosition || null);
    }
    existing.delete(id);
  });

  existing.forEach(item => item.remove());

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

  const temporaryId = newExpenseId();
  const currentDates = getAnalysisDateRange();
  const now = new Date();
  const belongsToCurrentFilter = now >= currentDates.start && now < currentDates.end;
  if (belongsToCurrentFilter) {
    expenses.push({ id: temporaryId, nombre, valor, pending: true });
  }
  nameInput.value = "";
  valueInput.value = "";
  setExpenseFormBusy(true);
  if (belongsToCurrentFilter) renderExpenses();

  expenseMutationCount++;
  try {
    const result = await sendExpenseChange("add_expense", {
      nombre,
      valor,
      mutationId: temporaryId
    });
    const savedExpense = normalizeExpense(result.expense);
    if (belongsToCurrentFilter) {
      expenses = expenses.map(item => item.id === temporaryId ? savedExpense : item);
      renderExpenses();
    }
  } catch (err) {
    console.error("Error agregando gasto:", err);
    if (belongsToCurrentFilter) {
      expenses = expenses.filter(item => item.id !== temporaryId);
      renderExpenses();
    }
    nameInput.value = nombre;
    valueInput.value = valor;
    alert(err.message || "No fue posible registrar el gasto. Intente nuevamente.");
  } finally {
    expenseMutationCount--;
    setExpenseFormBusy(false);
    fetchExpenses({ force: true });
  }
}



async function editExpense(expense) {
  if (!await confirmExpenseAction("edit", expense)) return;

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
    createExpenseButton("Cancelar", "expense-cancel", () => renderExpenses({ forceIds: [expense.id] }), "Cancelar edición")
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
    renderExpenses({ forceIds: [expense.id] });
    return;
  }

  const previousExpense = { ...expense };
  expenses = expenses.map(item => item.id === expense.id ? {
    ...item, nombre, valor, pending: true
  } : item);
  renderExpenses();

  expenseMutationCount++;
  try {
    const result = await sendExpenseChange("update_expense", {
      id: expense.id,
      nombre,
      valor
    });
    const savedExpense = normalizeExpense(result.expense);
    expenses = expenses.map(item => item.id === expense.id ? savedExpense : item);
    renderExpenses();
  } catch (err) {
    console.error("Error editando gasto:", err);
    expenses = expenses.map(item => item.id === expense.id ? previousExpense : item);
    renderExpenses();
    alert(err.message || "No fue posible editar el gasto. Intente nuevamente.");
  } finally {
    expenseMutationCount--;
    fetchExpenses({ force: true });
  }
}

async function deleteExpense(expense) {
  if (!await confirmExpenseAction("delete", expense)) return;

  const previousIndex = expenses.findIndex(item => item.id === expense.id);
  expenses = expenses.filter(item => item.id !== expense.id);
  renderExpenses();

  expenseMutationCount++;
  try {
    await sendExpenseChange("delete_expense", { id: expense.id });
  } catch (err) {
    console.error("Error eliminando gasto:", err);
    expenses.splice(Math.max(0, previousIndex), 0, expense);
    renderExpenses();
    alert(err.message || "No fue posible eliminar el gasto. Intente nuevamente.");
  } finally {
    expenseMutationCount--;
    fetchExpenses({ force: true });
  }
}

document.getElementById("expenseForm").addEventListener("submit", addExpense);

async function fetchExpenses({ force = false } = {}) {
  if (expenseRequestInFlight || expenseMutationCount > 0) return;

  const requestedMonth = ANALYSIS_STATE.month;
  const requestedYear = ANALYSIS_STATE.year;
  const requestedRange = ANALYSIS_STATE.range;
  const requestedDates = getAnalysisDateRange(requestedRange, requestedMonth, requestedYear);
  const requestedPeriodKey = getPeriodKey(requestedMonth, requestedYear, requestedRange);
  expenseRequestInFlight = true;

  try {
    const params = new URLSearchParams({
      action: "expenses",
      month: String(requestedMonth),
      year: String(requestedYear),
      from: String(requestedDates.start.getTime()),
      to: String(requestedDates.end.getTime()),
      _: Date.now().toString()
    });
    const res = await fetch(`${API}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Gastos HTTP ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data)) return;
    if (
      requestedMonth !== ANALYSIS_STATE.month ||
      requestedYear !== ANALYSIS_STATE.year ||
      requestedRange !== ANALYSIS_STATE.range
    ) return;
    if (expenseMutationCount > 0) return;

    const serverExpenses = data
      .filter(item => item && item.id != null && item.nombre && toStoreNumber(item.valor) > 0)
      .map(normalizeExpense);
    const fingerprint = getExpenseFingerprint(serverExpenses);
    const visibleFingerprint = getExpenseFingerprint(expenses.filter(item => !item.pending));
    const periodChanged = requestedPeriodKey !== lastExpensePeriodKey;

    if (
      periodChanged ||
      fingerprint !== lastExpenseFingerprint ||
      (force && visibleFingerprint !== fingerprint)
    ) {
      expenses = serverExpenses;
      lastExpenseFingerprint = fingerprint;
      lastExpensePeriodKey = requestedPeriodKey;
      renderExpenses();
    }
  } catch (err) {
    console.error("Error obteniendo gastos:", err);
  } finally {
    expenseRequestInFlight = false;
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


// Gastos se consultan directamente en Apps Script para reflejar otros dispositivos.
setInterval(() => {
  fetchExpenses();
}, EXPENSE_SYNC_INTERVAL);

// Los KPIs se sincronizan sin competir con los cambios manuales de filtro.
setInterval(() => {
  if (document.visibilityState === "visible") {
    fetchData({ force: true, background: true });
  }
}, KPI_REFRESH_INTERVAL);

function syncNowWhenReturning() {
  if (document.visibilityState === "visible") {
    fetchExpenses({ force: true });
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

// Primera carga: los gastos siempre llegan desde Apps Script.
latestStoreSnapshot = restoreStoreSnapshot();
renderExpenses({ refreshKpis: false });
fetchData({ force: true, background: Boolean(latestStoreSnapshot) }).finally(() => {
  fetchExpenses({ force: true });
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





 

