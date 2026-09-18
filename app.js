const API_URL = "https://script.google.com/macros/s/AKfycbwhbo8jmzp-rn_ZERDyl9sQXeIhGysgkopXjEW-CRV3yUQo6rj4NSvXg1O1NXXoPKKB/exec";



const tbody = document.getElementById("tbody");
const modal = document.getElementById("modal");
const form = document.getElementById("form");

const editModal = document.getElementById("editModal");
const editForm = document.getElementById("editForm");
const btnEditCancelar = document.getElementById("btnEditCancelar");


/* ======================
    NAVEGACIÓN ENTRE VISTAS
====================== */

const views = {
  analisis: document.getElementById("view-analisis")
};


document.querySelectorAll(".nav-menu a").forEach(link => {
  link.onclick = () => {
    document.querySelectorAll(".nav-menu a")
      .forEach(a => a.classList.remove("active"));

    link.classList.add("active");

    Object.values(views).forEach(v => v.classList.remove("active"));
    const view = link.dataset.view;
    views[view].classList.add("active");

    if (view === "ventas") {
         cargarVentas();
    }

    if (view === "analisis") {
        if (!window.__analysisInit) {
            window.__analysisInit = true;
            ANALYSIS.init();
  }
}

  };
});



function getNombreProductoFromRow(row) {
  const nameContainer = row.children[1].querySelector(".product-name");
  if (!nameContainer) return "";

  return nameContainer.childNodes[0].textContent.trim();
}



/* ======================
    KPI MODO PARA MOSTRAR EN VENTAS Y CAMBIAR CON EL BOTON PARA MOSTRAR EL DESCUENTO O LAS VENTAS
====================== */

let kpiModo = "ventas"; // "ventas" | "descuentos"
let kpiAnimating = false;

//  estado básico de editar prenda en el moda, este es independiente
let editBasicState = {
  id: null,
  product: null // 👈 producto completo
};

/* ======================
    ESTADO EDICIÓN PRODUCTO
====================== */
let editState = {
  mode: "create", // "create" | "edit"
  id: null,
  precioVenta: 0,
  margenOriginal: 0
};


/* ======================
   ESTADO DE CANTIDADES
====================== */
const qtyState = {};
const stockState = {};

/* ======================
   ESTADO CARRITO (MULTI)
====================== */
let sellCartState = {
  items: [], // [{ id, nombre, marca, precio, qty }]
  pending: false
};


/* ======================
   MODAL
====================== */
btnNuevo.onclick = () => {
  editState = { mode: "create", id: null };
  form.reset();
  modal.classList.remove("hidden");
};

btnCancelar.onclick = () => modal.classList.add("hidden");


/* ===============================
   GLOBAL LOADER CONTROL
================================ */
const loader = document.getElementById("globalLoader");

function showLoader(text = "Cargando información...") {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;

  loader.querySelector("span").textContent = text;
  loader.classList.remove("hidden");
}

function hideLoader() {
  const loader = document.getElementById("globalLoader");
  if (!loader) return;

  loader.classList.add("hidden");
}




/* =====================
   TOAST SYSTEM (GLOBAL)
===================== */
(function injectToastStyles() {
  if (document.getElementById("toast-styles")) return;

  const style = document.createElement("style");
  style.id = "toast-styles";
  style.innerHTML = `
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: linear-gradient(135deg, #0a84ff, #0066ff);
      color: white;
      padding: 14px 22px;
      border-radius: 16px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 10px 30px rgba(10,132,255,0.45);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 9999;
      backdrop-filter: blur(10px);
    }

    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  `;
  document.head.appendChild(style);
})();

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}




/* ======================
  VERIFICA SI EL PRODUCTO ES NUEVO DURANTE 24H
====================== */
function isProductoNuevo(fechaProducto) {
  if (!fechaProducto) return false;

  const fecha = new Date(fechaProducto);
  if (isNaN(fecha.getTime())) return false;

  return (Date.now() - fecha.getTime()) < 24 * 60 * 60 * 1000;
}


/* ======================
    TIEMPO DESDE FECHA PARA CALCULAR LAS HORAS DESDE QUE SE AGREGÓ EL PRODUCTO
====================== */
function tiempoDesde(fecha) {
  const diff = Date.now() - new Date(fecha).getTime();
  const horas = Math.floor(diff / (1000 * 60 * 60));
  return horas <= 1 ? "Hace menos de 1h" : `Hace ${horas}h`;
}



/* ======================
   CARGAR INVENTARIO
====================== */
async function cargarInventario() {
  try {
    showLoader("Cargando inventario...");

    const res = await fetch(`${API_URL}?action=list`);
    const data = await res.json();

    tbody.innerHTML = data.map(p => {

      // 🔒 Normalización local (anti-NaN)
      const precio = Number(
        String(p.precio ?? 0).replace(/[^\d.-]/g, "")
      ) || 0;

      const costo = Number(
        String(p.costo ?? 0).replace(/[^\d.-]/g, "")
      ) || 0;

      const stock = Number(p.stock) || 0;

      qtyState[p.id] = 0;
      stockState[p.id] = stock;

      setTimeout(() => updateStockUI(p.id));
      
      const esNuevo = isProductoNuevo(p.fecha);
      const tiempoNuevo = esNuevo ? tiempoDesde(p.fecha) : "";



      return `
        <tr
          data-id="${p.id}"
          class="${esNuevo ? "row-new" : ""}"
          ${esNuevo ? `title="Producto agregado ${tiempoNuevo}"` : ""}>

          <td><input type="checkbox" class="row-check"></td>

          <td>
          <div class="product-name">
          ${p.nombre}
          ${esNuevo ? `<div class="product-new-time">${tiempoNuevo}</div>` : ""}
          </div>
          </td>

          <td>${p.marca}</td>

          <td>$ ${precio.toLocaleString("es-CO")}</td>

          <!-- oculto pero seguro -->
          <td style="display:none;">
            $ ${costo.toLocaleString("es-CO")}
          </td>
          <td style="display:none;">${p.categoria}</td>
          <td style="display:none;">${p.subcategoria}</td>
          <!-- fin de ocultos pero seguros -->

          <td class="stock-cell" id="stock-${p.id}">
          ${stock > 0 
          ? stock 
          : '<span class="stock-out">Agotado</span>'
  }
</td>

          <td style="color:#00ff88">${p.vendidos}</td>

          <td class="actions">
            <div class="qty">
              <button data-id="${p.id}" onclick="cambiarQty('${p.id}', -1)">-</button>
              <span id="qty-${p.id}">0</span>
              <button data-id="${p.id}" onclick="cambiarQty('${p.id}', 1)">+</button>
            </div>

            <button onclick="editarProducto('${p.id}')">Editar</button>
            <button onclick="eliminarProducto('${p.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join("");

    actualizarTotalGlobalVenta();

  } catch (err) {
    console.error(err);
    showToast("❌ Error cargando inventario");
  } finally {
    hideLoader();
  }

  updateSellCartBadge();
}

cargarInventario();


/* ======================
    ACTUALIZAR UI STOCK CON COLORES Y BLOQUEO DE BOTONES 
====================== */
function updateStockUI(id) {
  const stock = stockState[id];
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;

  const stockCell = document.getElementById(`stock-${id}`);
  const buttons = row.querySelectorAll('.qty button');

  if (stock <= 0) {
    // texto
    if (stockCell) {
      stockCell.innerHTML = `<span class="stock-out">Agotado</span>`;
    }

    // bloquear botones
    buttons.forEach(b => b.disabled = true);

    // reset qty por seguridad
    qtyState[id] = 0;
    const span = document.getElementById(`qty-${id}`);
    if (span) span.textContent = "0";

  } else {
    // texto normal
    if (stockCell) {
      stockCell.textContent = stock;
    }

    // desbloquear botones
    buttons.forEach(b => b.disabled = false);
  }
}



/* ======================
    CARGAR VENTAS
====================== */
//parsea la fecha y hora en formato español a timestamp para que cargarventas ordene bien
// ==============================
// PARSE FECHA + HORA ESPAÑOL
// ==============================
function parseFechaHoraES(fecha, hora) {
  if (!fecha || !hora) return 0;

  const meses = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
  };

  // "Lunes 5 enero 2025"
  const f = fecha.split(" ");
  const day = Number(f[1]);
  const month = meses[f[2]];
  const year = Number(f[3]);

  // "3:45 PM"
  let [time, ampm] = hora.split(" ");
  let [h, m] = time.split(":").map(Number);

  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  return new Date(year, month, day, h, m, 0, 0).getTime();
}

// ==============================
// CARGAR VENTAS
// ==============================
const salesTbody = document.getElementById("salesTbody");

// Selects
const filterFecha = document.getElementById("filterFecha");
const filterProducto = document.getElementById("filterProducto");
const filterMarca = document.getElementById("filterMarca");
const filterMetodo1 = document.getElementById("filterMetodo1");
const filterMetodo2 = document.getElementById("filterMetodo2");

let salesData = []; // datos originales

async function cargarVentas() {
  try {
    showLoader("Cargando ventas...");

    const res = await fetch(`${API_URL}?action=sales`);
    let data = await res.json();

    // Orden cronológico real
    data = data
      .map((v, i) => ({ ...v, __idx: i }))
      .sort((a, b) => {
        const ta = parseFechaHoraES(a.fecha, a.hora);
        const tb = parseFechaHoraES(b.fecha, b.hora);
        if (tb !== ta) return tb - ta;
        return b.__idx - a.__idx;
      })
      .map(v => { delete v.__idx; return v; });

    salesData = data;

    // Llenar selects con opciones únicas
    populateFilters(data);

    renderVentas(salesData);

  } catch (e) {
    console.error(e);
    showToast("Error cargando ventas");
  } finally {
    hideLoader();
  }
}

/* =========================
   RENDER DE LA TABLA
   ========================= */
function renderVentas(data) {
  salesTbody.innerHTML = data.map(v => {
    const metodo1 = v.metodo1
      ? `<div><strong>${v.metodo1}</strong><div class="payment-amount">$ ${Number(v.monto1 || 0).toLocaleString("es-CO")}</div></div>`
      : "N/A";

    const metodo2 = v.metodo2
      ? `<div><strong>${v.metodo2}</strong><div class="payment-amount">$ ${Number(v.monto2 || 0).toLocaleString("es-CO")}</div></div>`
      : "N/A";

    const descuento = Number(v.descuento || 0);

    return `
      <tr>
        <td>${v.producto}</td>
        <td>${v.marca}</td>
        <td>${v.cantidad}</td>
        <td>$ ${Number(v.total).toLocaleString("es-CO")}</td>
        <td class="discount">${descuento > 0 ? `- $ ${descuento.toLocaleString("es-CO")}` : "N/A"}</td>
        <td>${metodo1}</td>
        <td>${metodo2}</td>
        <td>${v.fecha}</td>
        <td>${v.hora}</td>
      </tr>
    `;
  }).join("");
}

/* =========================
   POBLAR FILTROS
   ========================= */
/* =========================
   MÉTODOS DE PAGO FIJOS
   ========================= */
const METODOS_PAGO = [
  "Efectivo",
  "Transferencia",
  "Datafono",
  "Sistecredito",
  "Addi"
];

/* =========================
   POBLAR FILTROS
   ========================= */
function populateFilters(data) {
  const unique = (key) => [...new Set(data.map(d => d[key]).filter(Boolean))];

  fillSelect(filterProducto, unique('producto'), "Todos los productos");
  fillSelect(filterMarca, unique('marca'), "Todas las marcas");

  // 👇 métodos fijos
  fillSelect(filterMetodo1, METODOS_PAGO, "Todos los métodos de pago");
  fillSelect(filterMetodo2, METODOS_PAGO, "Todos los métodos de pago");
}

function fillSelect(select, items, placeholder) {
  select.innerHTML =
    `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i}">${i}</option>`).join('');
}




/* =========================
   FILTRADO DINÁMICO
   ========================= */
function filtrarVentas() {
  const filtered = salesData.filter(v => {
    const fechaVenta = new Date(v.fecha.split("/").reverse().join("-")); // yyyy-mm-dd

    const now = new Date();
    let fechaMatch = true;

    switch(filterFecha.value) {
      case 'hoy':
        fechaMatch = fechaVenta.toDateString() === now.toDateString();
        break;
      case 'ayer':
        const ayer = new Date(now);
        ayer.setDate(now.getDate() - 1);
        fechaMatch = fechaVenta.toDateString() === ayer.toDateString();
        break;
      case 'ultimos7':
        const semana = new Date(now);
        semana.setDate(now.getDate() - 7);
        fechaMatch = fechaVenta >= semana && fechaVenta <= now;
        break;
      case 'ultimos30':
        const mes = new Date(now);
        mes.setDate(now.getDate() - 30);
        fechaMatch = fechaVenta >= mes && fechaVenta <= now;
        break;
      default:
        fechaMatch = true;
    }

    return (
      fechaMatch &&
      (!filterProducto.value || v.producto === filterProducto.value) &&
      (!filterMarca.value || v.marca === filterMarca.value) &&
      (!filterMetodo1.value || v.metodo1 === filterMetodo1.value) &&
      (!filterMetodo2.value || v.metodo2 === filterMetodo2.value)
    );
  });

  renderVentas(filtered);
}

// Eventos de select
[filterFecha, filterProducto, filterMarca, filterMetodo1, filterMetodo2].forEach(sel => {
  sel.addEventListener('change', filtrarVentas);
});

// Inicia carga 
cargarVentas();



// ==============================
//  ACTUALIZAR KPIS VENTAS DEL DÍA
// ==============================
const ventasKPIContainer = document.getElementById("ventasKPI");

let lastKPIsUpdate = 0; // timestamp para no recalcular mucho

async function actualizarKPIVentas() {
  return new Promise(resolve => {

    const now = new Date();

    // Hora Bogotá
    const bogotaOffset = -5 * 60;
    const diff = bogotaOffset + now.getTimezoneOffset();
    const bogotaTime = new Date(now.getTime() + diff * 60000);

    const hoy = new Date(bogotaTime);
    hoy.setHours(0, 0, 0, 0);

    // ⏱️ protección anti-recarga excesiva (NO rompe el toggle)
    if (Date.now() - lastKPIsUpdate < 500 && !ventasKPIContainer.dataset.force) {
      requestAnimationFrame(resolve);
      return;
    }
    lastKPIsUpdate = Date.now();
    delete ventasKPIContainer.dataset.force;

    const rows = Array.from(salesTbody.querySelectorAll("tr"));

    const kpis = {};
    let totalDia = 0;
    let totalDescuentos = 0;

    rows.forEach(row => {
      const fechaText = row.children[7].textContent.trim();
      const horaText = row.children[8].textContent.trim();
      const ts = parseFechaHoraES(fechaText, horaText);

      if (ts < hoy.getTime()) return;

      // 💸 DESCUENTOS
      const descuentoText = row.children[4].textContent.replace(/[^\d]/g, "");
      const descuento = Number(descuentoText) || 0;
      totalDescuentos += descuento;

      // 💳 MÉTODOS
      [5, 6].forEach(i => {
        const metodo = row.children[i].querySelector("strong");
        const monto = row.children[i].querySelector(".payment-amount");

        if (metodo && monto) {
          const m = metodo.textContent.trim();
          const v = Number(monto.textContent.replace(/[^\d]/g, "")) || 0;
          kpis[m] = (kpis[m] || 0) + v;
          totalDia += v;
        }
      });
    });

    const orden = ["Efectivo","Transferencia","Datafono","Sistecredito","Addi"];

    const kpiPrincipal =
      kpiModo === "ventas"
        ? `
          <div class="kpi-label">Total Ventas del Día</div>
          <div class="kpi-value">$ ${totalDia.toLocaleString("es-CO")}</div>
        `
        : `
          <div class="kpi-label">Total Descuentos</div>
          <div class="kpi-value">$ ${totalDescuentos.toLocaleString("es-CO")}</div>
        `;

    ventasKPIContainer.innerHTML = `
      <div class="kpi-card kpi-main kpi-fade-in"
           style="flex:1 1 100%;
           background:${kpiModo === "ventas"
             ? "linear-gradient(135deg,#0a0a0a,#00aaff)"
             : "linear-gradient(135deg,#1a0a0a,#ff3366)"}">

        ${kpiPrincipal}

        <button class="kpi-toggle" onclick="toggleKPI()">
          ${kpiModo === "ventas" ? "Ver descuentos" : "Ver ventas"}
        </button>
      </div>

      ${orden.map(m => `
        <div class="kpi-card" style="background:${colorMetodoPago(m)}">
          <div class="kpi-label">${m}</div>
          <div class="kpi-value">$ ${(kpis[m] || 0).toLocaleString("es-CO")}</div>
        </div>
      `).join("")}
    `;

    // ✅ DOM ya pintó
    requestAnimationFrame(resolve);
  });
}


//   TOGGLE ENTRE VENTAS Y DESCUENTOS
async function toggleKPI() {

  const card = document.querySelector(".kpi-main");
  if (!card || card.dataset.loading === "1") return;
  card.dataset.loading = "1";

  // 🔹 crear overlay GLOBAL (no se destruye)
  let overlay = ventasKPIContainer.querySelector(".kpi-loader-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "kpi-loader-overlay";
    overlay.innerHTML = `<div class="kpi-loader"></div>`;
    ventasKPIContainer.style.position = "relative";
    ventasKPIContainer.appendChild(overlay);
  }

  // blur visual
  card.classList.add("kpi-loading");

  // forzar render aunque exista protección
  ventasKPIContainer.dataset.force = "1";

  // 🔁 cambiar modo
  kpiModo = kpiModo === "ventas" ? "descuentos" : "ventas";

  // ⏳ esperar a que llegue el nuevo KPI
  await actualizarKPIVentas();

  // 🔍 nuevo card (el anterior fue reemplazado)
  const newCard = document.querySelector(".kpi-main");

  // ✅ ahora sí quitar loader
  overlay.remove();
  newCard?.classList.remove("kpi-loading");
  delete newCard?.dataset.loading;
}




// Color alusivo para cada método
function colorMetodoPago(m) {
  switch(m) {
    case "Efectivo": return "linear-gradient(135deg,#1b1b1b,#00ff99)";       // verde neón sobre fondo oscuro
    case "Transferencia": return "linear-gradient(135deg,#121212,#3399ff)"; // azul neón oscuro
    case "Datafono": return "linear-gradient(135deg,#1a1a1a,#ff9933)";      // naranja neón oscuro
    case "Sistecredito": return "linear-gradient(135deg,#1c1c1c,#ff3366)";  // rojo neón oscuro
    case "Addi": return "linear-gradient(135deg,#111111,#cc33ff)";          // morado neón oscuro
    default: return "linear-gradient(135deg,#0a0a0a,#00aaff)";              // azul neón neutro
  }
}



// Actualiza cada 5 segundos
setInterval(actualizarKPIVentas, 5000);








/* ======================
   GUARDAR y EDITAR PRODUCTO
====================== */
form.onsubmit = async e => {
  e.preventDefault();

  const data = Object.fromEntries(new FormData(form));

  // 🔒 normalización
  data.costo = Number(data.costo) || 0;
  data.margen = Number(data.margen) || 0;
  data.cantidad = Number(data.cantidad) || 0;

  // 🔥 precio SIEMPRE desde costo
  data.precio = Math.round(
    data.costo * (1 + data.margen / 100)
  );

  if (!data.precio || data.precio <= 0) {
    showToast("❌ El precio no puede ser 0", "error");
    return;
  }

  if (editState.mode === "edit") {
    data.action = "update";
    data.id = editState.id;
  } else {
    data.action = "create";
  }

  showLoader(
    data.action === "update"
      ? "Actualizando producto..."
      : "Creando producto..."
  );

  await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify(data)
  });

  hideLoader();

  form.reset();
  modal.classList.add("hidden");

  // reset estado
  editState = {
    mode: "create",
    id: null
  };

  await cargarInventario();

  showToast(
    data.action === "update"
      ? "Producto actualizado correctamente"
      : "Producto creado correctamente"
  );
};







/* ======================
    ACTUALIZAR EL SPAN TOTAL A PAGAR 
====================== */
function actualizarTotalGlobalVenta() {
  let total = 0;
  let haySeleccion = false;

  Object.keys(qtyState).forEach(id => {
    const qty = qtyState[id];
    if (!qty || qty <= 0) return;

    haySeleccion = true;

    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return;

    const precio = Number(
      row.children[3].textContent.replace(/[^\d]/g, "")
    );

    total += precio * qty;
  });

  const span = document.getElementById("sellTotal");
  if (!span) return;

  span.textContent = haySeleccion
    ? total.toLocaleString("es-CO")
    : "0";
}



/* ======================
   CAMBIAR CANTIDAD (+ / -)
====================== */
window.cambiarQty = function (id, delta) {

  const stock = stockState[id] || 0; // 👈 stock disponible del producto

  // 🚫 Si intenta sumar y ya llegó al stock, no hacer nada
  if (delta > 0 && qtyState[id] >= stock) return;

  qtyState[id] += delta;

  if (qtyState[id] < 0) qtyState[id] = 0;

  // 🔒 Seguridad extra (nunca pasar stock)
  if (qtyState[id] > stock) qtyState[id] = stock;

  const span = document.getElementById(`qty-${id}`);
  if (span) span.textContent = qtyState[id];

  // 🔥 lo que YA funcionaba (NO SE TOCA)
  actualizarTotalGlobalVenta();
  updateSellCartBadge();
};


/* ======================
   VENDER (CON VALIDACIÓN)
====================== */
let sellState = {
  id: null,
  nombre: "",
  precio: 0,
  qty: 0,
  pending: false
};


window.venderDesdeFila = function (id) {
  const qty = qtyState[id];
  const stock = stockState[id];

  if (qty <= 0) {
    showToast("Selecciona una cantidad mayor a 0");
    return;
  }

  if (qty > stock) {
    showToast(`No es posible vender ${qty}. En stock solo hay ${stock}.`);
    return;
  }

  const row = document.querySelector(`tr[data-id="${id}"]`);
  const nombre = getNombreProductoFromRow(row);
  const precio = Number(row.children[3].textContent.replace(/[^\d]/g, ""));

  sellState = {
    id,
    nombre,
    precio,
    qty,
    pending: true
  };

  openSellModal();
};

/* ======================
    VENDER SELECCIONADOS
====================== */

window.venderSeleccionados = function () {
  const rows = document.querySelectorAll("tbody tr");
  const items = [];

  rows.forEach(row => {
    const id = row.dataset.id;
    const qty = qtyState[id];
    const stock = stockState[id];

    // 🔑 ÚNICA CONDICIÓN: cantidad > 0
    if (qty > 0) {
      if (qty > stock) {
        showToast(`Stock insuficiente para ${row.children[1].textContent}`);
        return;
      }

      items.push({
  id,
  nombre: getNombreProductoFromRow(row),
  marca: row.children[2].textContent.trim(),
  precio: Number(row.children[3].textContent.replace(/[^\d]/g, "")),
  qty
});

    }
  });

  if (!items.length) {
    return showToast("No hay productos con cantidad seleccionada");
  }

  // ✅ MISMO OBJETO, SOLO SE AGREGA CONTEXTO
  sellCartState = {
    items,
    pending: true,
    __from: "btnSellCart" // 👈 identifica venta múltiple
  };

  openSellCartModal();
};

/* ======================
    CALCULAR TOTAL VENTA MULTIPLE
====================== */
function calcularTotalVentaMultiple() {
  return sellCartState.items.reduce(
    (sum, i) => sum + i.precio * i.qty,
    0
  );
}


/* ======================
    MODAL VENDER SELECCIONADOS
====================== */
function openSellCartModal() {
  const old = document.getElementById("sellCartModal");
  if (old) old.remove();

  // 🎨 ESTILOS SOLO SI VIENE DE "VENDER SELECCIONADOS"
  if (sellCartState.__from === "btnSellCart") {
    if (!document.getElementById("sellModalStyles")) {
      const style = document.createElement("style");
      style.id = "sellModalStyles";
      style.innerHTML = `
        .sell-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,.45);
          display: grid;
          place-items: center;
          z-index: 2000;
        }

        .sell-card {
          width: 520px;
          max-width: 94vw;
          background: rgba(20,20,30,.95);
          backdrop-filter: blur(30px);
          border-radius: 28px;
          padding: 28px;
          color: white;
          box-shadow: 0 30px 80px rgba(0,0,0,.6);
        }

        .sell-sub {
          font-size: 13px;
          opacity: .7;
          margin-bottom: 18px;
        }

        .sell-section {
          margin-bottom: 18px;
        }

        .sell-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .sell-field label {
          font-size: 12px;
          opacity: .7;
          margin-bottom: 6px;
          display: block;
        }

        .sell-field input,
        .sell-field select {
          width: 100%;
          padding: 13px 14px;
          border-radius: 14px;
          border: none;
          outline: none;
          background: rgba(15,20,35,.95);
          color: white;
        }

        .sell-total {
          background: linear-gradient(135deg,#0a84ff,#0066ff);
          padding: 14px;
          border-radius: 16px;
          text-align: center;
          font-weight: 700;
          margin-top: 14px;
        }

        .sell-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 22px;
        }

        .sell-actions .ghost {
          background: transparent;
          color: white;
          border: 1px solid rgba(255,255,255,.25);
        }

        .sell-actions .primary {
          background: linear-gradient(135deg,#0a84ff,#0066ff);
          color: white;
        }

        .sell-actions button {
        padding: 12px 18px;
        border-radius: 14px;
        border: none;
        cursor: pointer;
        font-weight: 600;
        transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease;
      }

       .sell-actions button:hover {
       transform: translateY(-1px);
       box-shadow: 0 8px 20px rgba(0,0,0,.35);
       }

      .sell-actions .ghost:hover {
      background: rgba(255,255,255,.08);
      }

      .sell-actions .primary:hover {
      opacity: .95;
     }

      `;
      document.head.appendChild(style);
    }
  }

  const total = calcularTotalVentaMultiple();


  const modal = document.createElement("div");
  modal.id = "sellCartModal";
  modal.className = "sell-overlay";

  // 🔒 HTML EXACTO COMO LO TENÍAS
  modal.innerHTML = `
    <div class="sell-card" style="width:520px">
      <h2>Venta múltiple</h2>
      <div class="sell-sub">Resumen de prendas seleccionadas</div>

      <div class="sell-section">
        ${sellCartState.items.map(i => `
          <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px">
            <span>${i.nombre} × ${i.qty}</span>
            <b>$ ${(i.precio * i.qty).toLocaleString("es-CO")}</b>
          </div>
        `).join("")}
      </div>

        <div class="sell-field">
          <label>Descuento</label>
          <input type="number" id="cartDiscount" value="0" min="0">
        </div>

      <div class="sell-section">
        <div class="sell-grid">
        
          <div class="sell-field">
            <label>Método de pago 1</label>
            <select id="cartPayMethod1">
               <option>Efectivo</option>
               <option>Transferencia</option>
               <option>Datafono</option>
               <option>Sistecredito</option>
               <option>Addi</option>
            </select>
          </div>

          <div class="sell-field">
            <label>Monto</label>
            <input type="number" id="cartPayAmount1" value="${total}">
          </div>

          <div class="sell-field">
            <label>Método de pago 2</label>
            <select id="cartPayMethod2">
               <option>Ninguno</option>
               <option>Efectivo</option>
               <option>Transferencia</option>
               <option>Datafono</option>
               <option>Sistecredito</option>
               <option>Addi</option>
            </select>
          </div>

          <div class="sell-field">
            <label>Monto</label>
            <input type="number" id="cartPayAmount2" value="0" readonly>
          </div>
        </div>
      </div>

      <div class="sell-total">
        Total Venta: $ <span id="cartTotal">${total.toLocaleString("es-CO")}</span>
      </div>

      <div class="sell-actions">
        <button class="ghost" onclick="closeSellCartModal()">Cancelar</button>
        <button class="primary" onclick="confirmarVentaMultiple()">Confirmar venta</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // ======================
// 🔗 REFERENCIAS DOM (MODAL)
// ======================
const cartDiscount = document.getElementById("cartDiscount");
const cartPayAmount1 = document.getElementById("cartPayAmount1");
const cartPayAmount2 = document.getElementById("cartPayAmount2");
const cartPayMethod2 = document.getElementById("cartPayMethod2");
const cartTotal = document.getElementById("cartTotal");

// ======================
// 🧠 LISTENERS INTELIGENTES
// ======================
cartDiscount.addEventListener("input", () => updateCartTotals("discount"));
cartPayAmount1.addEventListener("input", () => updateCartTotals("monto1"));
cartPayAmount2.addEventListener("input", () => updateCartTotals("monto2"));
cartPayMethod2.addEventListener("change", () => updateCartTotals("method"));

// estado inicial
updateCartTotals("init");

}





/* ======================
    CALCULAR TOTAL CON DESCUENTO
====================== */
function calcularTotalConDescuento() {
  const subtotal = calcularTotalVentaMultiple();
  const descuento = Number(document.getElementById("cartDiscount")?.value || 0);
  return Math.max(subtotal - descuento, 0);
}


/* ======================
    ACTUALIZAR TOTALES VENTA MULTIPLE
====================== */
function updateCartTotals(source = "init") {
  const subtotal = calcularTotalVentaMultiple();
  const descuento = Number(cartDiscount.value || 0);
  const totalFinal = Math.max(subtotal - descuento, 0);

  const metodo2 = cartPayMethod2.value;

  let monto1 = Number(cartPayAmount1.value || 0);
  let monto2 = Number(cartPayAmount2.value || 0);

  if (metodo2 === "Ninguno") {
    monto1 = totalFinal;
    monto2 = 0;
  } else {
    if (source === "discount" || source === "method" || source === "init") {
      monto1 = Math.floor(totalFinal / 2);
      monto2 = totalFinal - monto1;
    } else if (source === "monto1") {
      monto1 = Math.min(monto1, totalFinal);
      monto2 = totalFinal - monto1;
    } else if (source === "monto2") {
      monto2 = Math.min(monto2, totalFinal);
      monto1 = totalFinal - monto2;
    }
  }

  cartPayAmount1.value = Math.max(monto1, 0);
  cartPayAmount2.value = Math.max(monto2, 0);
  cartTotal.textContent = totalFinal.toLocaleString("es-CO");
}






/* ======================
    NORMALIZAR PAGOS VENTA MULTIPLE
====================== */
function normalizarPagos(metodo1, monto1, metodo2, monto2, total) {
  let m1 = metodo1;
  let v1 = Number(monto1) || 0;

  let m2 = metodo2;
  let v2 = Number(monto2) || 0;

  // 🔒 Si método 2 es "Ninguno", fuerza monto 2 = 0
  if (m2 === "Ninguno") {
    m2 = "";
    v2 = 0;
  }

  // 🔒 Si solo hay un método, absorbe todo
  if (!m2) {
    v1 = total;
    v2 = 0;
  }

  // 🔒 Ajuste final por seguridad
  if (v1 + v2 !== total) {
    v1 = total;
    v2 = 0;
    m2 = "";
  }

  return {
    metodo1: m1,
    monto1: v1,
    metodo2: m2,
    monto2: v2
  };
}

 
/* ======================
    CONFIRMAR VENTA MULTIPLE (PROPORCIONAL REAL)
====================== */
async function confirmarVentaMultiple() {
  try {
    showLoader("Procesando venta...");

    const metodo1 = document.getElementById("cartPayMethod1").value;
    const metodo2 = document.getElementById("cartPayMethod2").value;

    let monto1 = Number(document.getElementById("cartPayAmount1").value || 0);
    let monto2 = Number(document.getElementById("cartPayAmount2").value || 0);

    const descuento = Number(document.getElementById("cartDiscount").value || 0);

    const items = sellCartState.items;

    const totalVenta = items.reduce(
      (s, i) => s + i.precio * i.qty,
      0
    );

    const totalConDescuento = totalVenta - descuento;

    // 🛑 VALIDACIÓN CORRECTA (YA CON DESCUENTO)
    if (monto1 + monto2 !== totalConDescuento) {
      hideLoader();
      return showToast(
        "La suma de pagos no coincide con el total con descuento",
        "error"
      );
    }

    // 🔐 Normalizar métodos
    const pagos = normalizarPagos(
      metodo1,
      monto1,
      metodo2,
      monto2,
      totalConDescuento
    );

    // 📊 Porcentajes reales (SOBRE TOTAL CON DESCUENTO)
    const pct1 = pagos.monto1 / totalConDescuento;
    const pct2 = pagos.monto2 / totalConDescuento;

    let acumulado1 = 0;
    let acumulado2 = 0;

    let index = 1;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      showLoader(`Procesando venta ${index}/${items.length}...`);

      const subtotalItem = item.precio * item.qty;

      // 🔻 Descuento proporcional por producto
      const descuentoItem = Math.round(subtotalItem * (descuento / totalVenta));

      const totalItem = subtotalItem - descuentoItem;

      // 💰 Montos proporcionales por producto
      let itemMonto1 = Math.round(totalItem * pct1);
      let itemMonto2 = Math.round(totalItem * pct2);

      acumulado1 += itemMonto1;
      acumulado2 += itemMonto2;

      // 🧮 Ajuste final por redondeo
      if (i === items.length - 1) {
        itemMonto1 += pagos.monto1 - acumulado1;
        itemMonto2 += pagos.monto2 - acumulado2;
      }

      await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({
          action: "sell_full",

          id: item.id,
          producto: item.nombre,
          marca: item.marca,

          cantidad: item.qty,
          precioUnitario: item.precio,
          subtotal: subtotalItem,
          descuento: descuentoItem,
          total: totalItem,

          // ✅ PAGOS REALES POR PRODUCTO
          metodo1: pagos.metodo1,
          monto1: itemMonto1,
          metodo2: pagos.metodo2,
          monto2: itemMonto2
        })
      });

      index++;
    }

    closeSellCartModal();
    await cargarInventario();
    showToast("Venta múltiple registrada correctamente", "success");

  } catch (e) {
    console.error(e);
    showToast("Error en venta múltiple", "error");

  } finally {
    hideLoader();
  }

  updateSellCartBadge(); // 🔥 actualizamos badge del carrito
}





/* ======================
    CERRAR MODAL VENDER SELECCIONADOS
====================== */

function closeSellCartModal() {
  const modal = document.getElementById("sellCartModal");
  if (modal) modal.remove();
}



/* ======================
    MODAL VENDER INDIVIDUAL
====================== */

const sellModal = document.getElementById("sellModal");
const sellTitle = document.getElementById("sellTitle");
const sellInfo = document.getElementById("sellInfo");

function openSellModal() {
  const { nombre, precio, qty } = sellState;
  const totalInicial = precio * qty;

  // 🧹 eliminar modal previo
  const old = document.getElementById("sellModalDynamic");
  if (old) old.remove();

  // 🎨 estilos (una sola vez)
  if (!document.getElementById("sellModalStyles")) {
    const style = document.createElement("style");
    style.id = "sellModalStyles";
    style.innerHTML = `
      .sell-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.45);
        display: grid;
        place-items: center;
        z-index: 2000;
      }

      .sell-card {
        width: 420px;
        max-width: 94vw;
        background: rgba(20,20,30,.95);
        backdrop-filter: blur(30px);
        border-radius: 28px;
        padding: 28px;
        color: white;
        box-shadow: 0 30px 80px rgba(0,0,0,.6);
      }

      .sell-card h2 {
        margin-bottom: 4px;
      }

      .sell-sub {
        font-size: 13px;
        opacity: .7;
        margin-bottom: 18px;
      }

      .sell-section {
        margin-bottom: 18px;
      }

      .sell-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      .sell-field label {
        font-size: 12px;
        opacity: .7;
        margin-bottom: 6px;
        display: block;
      }

      .sell-field input,
      .sell-field select {
        width: 100%;
        padding: 13px 14px;
        border-radius: 14px;
        border: none;
        outline: none;
        background: rgba(15,20,35,.95);
        color: white;
        appearance: none;
      }

      .sell-field select {
        cursor: pointer;
        background-image:
          linear-gradient(45deg, transparent 50%, #0a84ff 50%),
          linear-gradient(135deg, #0a84ff 50%, transparent 50%);
        background-position:
          calc(100% - 20px) 55%,
          calc(100% - 14px) 55%;
        background-size: 6px 6px;
        background-repeat: no-repeat;
      }

      .sell-total {
        background: linear-gradient(135deg,#0a84ff,#0066ff);
        padding: 14px;
        border-radius: 16px;
        text-align: center;
        font-weight: 700;
        margin-top: 14px;
      }

      .sell-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 22px;
      }

      .sell-actions button {
        padding: 12px 18px;
        border-radius: 14px;
        border: none;
        cursor: pointer;
        font-weight: 600;
      }

      .sell-actions .ghost {
        background: transparent;
        color: white;
        border: 1px solid rgba(255,255,255,.25);
      }

      .sell-actions .primary {
        background: linear-gradient(135deg,#0a84ff,#0066ff);
        color: white;
      }
    `;
    document.head.appendChild(style);
  }

  // 🧩 modal
  const modal = document.createElement("div");
  modal.id = "sellModalDynamic";
  modal.className = "sell-overlay";

  modal.innerHTML = `
    <div class="sell-card">
      <h2>${nombre}</h2>
      <div class="sell-sub">Confirma los detalles de la venta</div>

      <div class="sell-section">
        <div class="sell-grid">
          <div class="sell-field">
            <label>Cantidad *</label>
            <input type="number" id="sellQty" min="1" value="${qty}">
          </div>

          <div class="sell-field">
            <label>Descuento</label>
            <input type="number" id="sellDiscount" value="0">
          </div>
        </div>
      </div>

      <div class="sell-section">
        <div class="sell-grid">
          <div class="sell-field">
            <label>Método de pago 1</label>
            <select id="payMethod1">
               <option>Efectivo</option>
               <option>Transferencia</option>
               <option>Datafono</option>
               <option>Sistecredito</option>
               <option>Addi</option>
            </select>
          </div>

          <div class="sell-field">
            <label>Monto</label>
            <input type="number" id="payAmount1" value="${totalInicial}">
          </div>

          <div class="sell-field">
            <label>Método de pago 2</label>
            <select id="payMethod2">
              <option>Ninguno</option>
              <option>Efectivo</option>
              <option>Transferencia</option>
              <option>Datafono</option>
              <option>Sistecredito</option>
              <option>Addi</option>
            </select>
          </div>

          <div class="sell-field">
            <label>Monto</label>
            <input type="number" id="payAmount2" value="0" readonly>
          </div>
        </div>
      </div>

      <div class="sell-total">
        Total Venta: $ <span id="sellTotal">${totalInicial.toLocaleString("es-CO")}</span>
      </div>

      <div class="sell-actions">
        <button class="ghost" onclick="closeSellModal()">Cancelar</button>
        <button class="primary" onclick="confirmarVenta()">Confirmar venta</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 🧠 listeners de lógica
  ["sellQty", "sellDiscount", "payAmount1"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateSellTotals);
  });

  // estado inicial correcto
  updateSellTotals();
}




/* ======================
    ACTUALIZAR TOTALES VENTA
====================== */
function updateSellTotals() {
  const qty = Number(document.getElementById("sellQty").value) || 0;
  const discount = Number(document.getElementById("sellDiscount").value) || 0;

  const total = Math.max(
    sellState.precio * qty - discount,
    0
  );

  const amount1 = Number(document.getElementById("payAmount1").value) || 0;
  const amount2 = total - amount1;

  document.getElementById("payAmount2").value = amount2 >= 0 ? amount2 : 0;

  document.getElementById("sellTotal").textContent =
    total.toLocaleString("es-CO");
}

["sellQty", "sellDiscount", "payAmount1"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateSellTotals);
});


/* ======================
    ACTUALIZAR BADGE CARRITO
====================== */
function updateSellCartBadge() {
  const badge = document.getElementById("sellCartBadge");
  if (!badge) return;

  let totalItems = 0;

  Object.values(qtyState).forEach(qty => {
    if (qty > 0) totalItems += qty;
  });

  if (totalItems <= 0) {
    badge.classList.add("hidden");
    badge.textContent = "0";
    return;
  }

  badge.textContent = totalItems;
  badge.classList.remove("hidden");

  // ✨ animación premium
  badge.classList.remove("bump");
  void badge.offsetWidth; // force reflow
  badge.classList.add("bump");
}


 


/* ======================
    CONFIRMAR VENTA SIMPLE
====================== */
async function confirmarVenta() {
  if (!sellState) return;

  try {
    showLoader("Confirmando venta...");

    const qty = Number(document.getElementById("sellQty").value);
    const descuento = Number(document.getElementById("sellDiscount").value || 0);

    const metodo1 = document.getElementById("payMethod1").value;
    const metodo2 = document.getElementById("payMethod2").value;

    const monto1 = Number(document.getElementById("payAmount1").value || 0);
    const monto2 = Number(document.getElementById("payAmount2").value || 0);

    const { id, nombre, marca, precio } = sellState;

    const subtotal = precio * qty;
    const total = subtotal - descuento;

    // 🛑 validaciones duras
    if (qty <= 0) {
      hideLoader();
      return showToast("Cantidad inválida", "error");
    }

    if (monto1 + monto2 !== total) {
      hideLoader();
      return showToast(
        "La suma de los pagos no coincide con el total",
        "error"
      );
    }

    // ✅ normalizar pagos
    const pagos = normalizarPagos(
      metodo1,
      monto1,
      metodo2,
      monto2,
      total
    );

    await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "sell_full",

        id,
        producto: nombre,
        marca,

        cantidad: qty,
        precioUnitario: precio,
        subtotal,
        descuento,
        total,

        metodo1: pagos.metodo1,
        monto1: pagos.monto1,
        metodo2: pagos.metodo2,
        monto2: pagos.monto2
      })
    });

    qtyState[id] = 0;
    sellState.pending = false;

    closeSellModal();
    await cargarInventario();

    showToast("Venta registrada correctamente", "success");

  } catch (err) {
    console.error(err);
    showToast("Error al registrar la venta", "error");

  } finally {
    hideLoader();
  }
}






/* ======================
    CERRAR MODAL VENDER
====================== */

function closeSellModal() {
  const modal = document.getElementById("sellModalDynamic");
  if (modal) modal.remove();
}



/* ====================== 
    EDITAR PRODUCTO
====================== */

function editarProducto(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;

  const modal = document.getElementById("modal");
  const form = document.getElementById("form");

  const nombre = row.children[1].querySelector(".product-name").childNodes[0].textContent.trim();
  const marca = row.children[2].textContent.trim();

  const costo = Number(
    row.children[4].textContent.replace(/[^\d]/g, "")
  );

  const categoria = row.children[5].textContent.trim();
  const subcategoria = row.children[6].textContent.trim();
  const cantidad = Number(row.children[7].textContent) || 0;

  // 🔹 llenar solo campos editables
  form.nombre.value = nombre;
  form.marca.value = marca;
  form.categoria.value = categoria;
  form.subcategoria.value = subcategoria;
  form.cantidad.value = cantidad;

  // 🔹 costo real (base del cálculo)
  form.costo.value = costo;

  // margen solo como input de cálculo
  form.margen.value = 100;

  // 🔐 estado de edición (mínimo necesario)
  editState = {
    mode: "edit",
    id
  };

  modal.classList.remove("hidden");
}


/* ======================
   ELIMINAR PRODUCTO (CON VALIDACIÓN)
====================== */

async function eliminarProducto(id) {
  const confirmacion = confirm(
    "¿Seguro que deseas eliminar este producto?\nEsta acción no se puede deshacer."
  );

  if (!confirmacion) return;

  showLoader("Eliminando producto...");

  await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({
      action: "delete",
      id
    })
  });

  hideLoader();
  showToast("Producto eliminado correctamente");
  cargarInventario();
};









/* ======================
   TOAST NEÓN (ESTILOS EN JS)
====================== */
// (function injectToastStyles() {
//   if (document.getElementById("toastStyles")) return;

//   const style = document.createElement("style");
//   style.id = "toastStyles";
//   style.innerHTML = `
//     .toast {
//       position: fixed;
//       bottom: 24px;
//       left: 50%;
//       transform: translateX(-50%) translateY(20px);
//       background: linear-gradient(135deg, #0a84ff, #0066ff);
//       color: white;
//       padding: 14px 22px;
//       border-radius: 16px;
//       font-weight: 600;
//       font-size: 14px;
//       box-shadow: 0 10px 30px rgba(10,132,255,0.45);
//       opacity: 0;
//       transition: all 0.3s ease;
//       z-index: 10000; /* MÁS QUE EL MODAL */
//       pointer-events: none;
//       isolation: isolate;
//     }

//     .toast.show {
//       opacity: 1;
//       transform: translateX(-50%) translateY(0);
//     }
//   `;
//   document.head.appendChild(style);
// })();


// function showToast(message) {
//   const toast = document.createElement("div");
//   toast.className = "toast";
//   toast.textContent = message;

//   document.body.appendChild(toast);

//   requestAnimationFrame(() => {
//     toast.classList.add("show");
//   });

//   setTimeout(() => {
//     toast.classList.remove("show");
//     setTimeout(() => toast.remove(), 300);
//   }, 3000);
// }
