(function () {
  "use strict";

  var STORE_KEY = "ringkasanLaptopState.v1";
  var AUTO_PARSE_DELAY = 320;
  var autoParseTimer = 0;
  var products = [];
  var storedOverrides = {};
  var activeView = "table";
  var logoPath = "asset/logo.png";
  var logoDataUrl = "";
  var logoLoadPromise = null;
  var logoPreviewMaxWidth = 220;
  var logoPreviewMaxHeight = 210;
  var storeInfo = {
    name: "Service Komputer Surabaya",
    address: "Jl. Medokan Sawah Timur Gg. 1A No. 10 Kav. 22A",
    phone: "WA/Phone: (+62) 899 4335 111",
    web: "https://servicekomputersurabaya.id",
    trustText: "Konsultasi, Pilih, Deal, Transfer & Percaya serta yakin untuk bertransaksi.",
    hours: "Jam buka toko 09.00 - 17.00 WIB. Untuk Konsultasi Laptop 24 jam (respon menyesuaikan ketika online WA)"
  };

  var elements = {
    rawInput: document.getElementById("rawInput"),
    fileInput: document.getElementById("fileInput"),
    parseButton: document.getElementById("parseButton"),
    clearButton: document.getElementById("clearButton"),
    resultBody: document.getElementById("resultBody"),
    parseStatus: document.getElementById("parseStatus"),
    totalItems: document.getElementById("totalItems"),
    totalStock: document.getElementById("totalStock"),
    lowestPrice: document.getElementById("lowestPrice"),
    searchInput: document.getElementById("searchInput"),
    categoryFilter: document.getElementById("categoryFilter"),
    percentInput: document.getElementById("percentInput"),
    percentBase: document.getElementById("percentBase"),
    applyPercentButton: document.getElementById("applyPercentButton"),
    resetPriceButton: document.getElementById("resetPriceButton"),
    valueInput: document.getElementById("valueInput"),
    applyValueButton: document.getElementById("applyValueButton"),
    copyCsvButton: document.getElementById("copyCsvButton"),
    downloadCsvButton: document.getElementById("downloadCsvButton"),
    downloadPdfButton: document.getElementById("downloadPdfButton"),
    downloadHtmlButton: document.getElementById("downloadHtmlButton"),
    csvOutput: document.getElementById("csvOutput"),
    promoGrid: document.getElementById("promoGrid"),
    tabButtons: Array.prototype.slice.call(document.querySelectorAll(".tab-button")),
    views: {
      table: document.getElementById("tableView"),
      csv: document.getElementById("csvView"),
      promo: document.getElementById("promoView")
    }
  };

  function normalizeCommonText(value) {
    var text = String(value || "");
    var replacements = [
      ["\u00e2\u02c6\u0161", "\u221a"],
      ["\u00e2\u0153\u2026", ""],
      ["\u00f0\u0178\u2019\u00b0", ""],
      ["\u00f0\u0178\u201d\u00a5", ""],
      ["\u00f0\u0178\u2122\u008f", ""],
      ["\u00e2\u20ac\u009d", "\""],
      ["\u00e2\u20ac\u009c", "\""],
      ["\u00e2\u20ac\u0098", "'"],
      ["\u00e2\u20ac\u2122", "'"],
      ["\u00e2\u20ac\u00bc\u00ef\u00b8\u008f", "!!"],
      ["\u00c2\u00b0", " derajat"],
      ["\u00c2", ""]
    ];

    replacements.forEach(function (pair) {
      text = text.split(pair[0]).join(pair[1]);
    });

    return text;
  }

  function cleanLine(line) {
    return normalizeCommonText(line)
      .replace(/\u00a0/g, " ")
      .replace(/[*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSeparator(line) {
    return /^[=\-]{4,}$/.test(line.trim());
  }

  function hasTitleMarker(line) {
    return cleanLine(line).indexOf("\u221a") !== -1;
  }

  function isStatusLine(line) {
    return /^status\s*:/i.test(cleanLine(line));
  }

  function isCategoryLine(line) {
    var cleaned = cleanLine(line);
    var upper = cleaned.toUpperCase();
    var plain = upper.replace(/[^\w\s&/+-]/g, "").trim();

    if (!cleaned || hasTitleMarker(cleaned) || upper.indexOf("HARGA") !== -1) {
      return false;
    }

    if (upper.indexOf("UPDATE PRICELIST") !== -1 || upper.indexOf("#NOTE") !== -1) {
      return false;
    }

    if (upper.indexOf("LAPTOP") === -1 || cleaned.length > 58) {
      return false;
    }

    return /^[A-Z0-9\s&/+-]+$/.test(plain);
  }

  function extractCategory(line) {
    var cleaned = cleanLine(line)
      .replace(/^[^\w]+/, "")
      .replace(/^LAPTOP\s+/i, "")
      .trim();

    return cleaned ? cleaned.toUpperCase() : "LAINNYA";
  }

  function cleanTitle(line) {
    return cleanLine(line)
      .replace(/\u221a/g, "")
      .replace(/^[^\w]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function inferCategory(title) {
    var cleaned = cleanTitle(title).replace(/^LAPTOP\s+/i, "").trim();
    var firstWord = cleaned.split(/\s+/)[0] || "LAINNYA";
    return firstWord.toUpperCase();
  }

  function parseCurrency(value) {
    var text = cleanLine(value).toLowerCase();
    var jutaMatch = text.match(/([0-9]+(?:[,.][0-9]+)?)\s*juta/);

    if (jutaMatch) {
      return Math.round(Number(jutaMatch[1].replace(",", ".")) * 1000000);
    }

    var rpMatch = text.match(/rp\s*([0-9.,\s]+)/i);
    var source = rpMatch ? rpMatch[1] : text;
    var digits = source.replace(/[^\d]/g, "");

    if (!digits) {
      return 0;
    }

    return Number(digits);
  }

  function parsePriceLine(line) {
    var cleaned = cleanLine(line);
    if (!/(harga|rp|juta)/i.test(cleaned)) {
      return null;
    }

    var price = parseCurrency(cleaned);
    return price > 0 ? price : null;
  }

  function parseStockLine(line) {
    var cleaned = cleanLine(line);
    var match = cleaned.match(/stock\s*:?\s*([0-9]+)/i);
    return match ? Number(match[1]) : null;
  }

  function firstMatchingLine(lines, pattern) {
    return lines.find(function (line) {
      return pattern.test(line);
    }) || "";
  }

  function extractFields(specs) {
    return {
      processor: firstMatchingLine(specs, /(processor|procesor|cpu)/i),
      ram: firstMatchingLine(specs, /\bram\b/i),
      storage: firstMatchingLine(specs, /\b(ssd|hdd|storage|nvme|emmc)\b/i),
      vga: firstMatchingLine(specs, /(^\s*(double\s+)?vga\b|\bgraphics\b|\bradeon\b|\bnvidia\b|\bquadro\b|\bgeforce\b|\brtx\b|\biris\b)/i),
      screen: firstMatchingLine(specs, /(layar|inch|touchscreen|fhd)/i)
    };
  }

  function finalizeProduct(item, list) {
    if (!item || !item.title) {
      return;
    }

    item.specs = item.specs
      .map(cleanLine)
      .filter(function (line) {
        return line && !isStatusLine(line) && !isSeparator(line);
      });

    var fields = extractFields(item.specs);
    item.id = list.length + 1;
    item.category = item.category || inferCategory(item.title);
    item.processor = fields.processor;
    item.ram = fields.ram;
    item.storage = fields.storage;
    item.vga = fields.vga;
    item.screen = fields.screen;
    item.priceOriginal = Number(item.priceOriginal || 0);
    item.priceEdited = item.priceOriginal;
    item.stock = item.stock === null || item.stock === undefined ? "" : item.stock;

    list.push(item);
  }

  function parseLaptopData(rawText) {
    var lines = normalizeCommonText(rawText).split(/\r?\n/);
    var list = [];
    var current = null;
    var category = "";
    var pendingNotes = [];

    lines.forEach(function (rawLine) {
      var line = cleanLine(rawLine);

      if (!line || isSeparator(line)) {
        return;
      }

      if (isCategoryLine(line)) {
        category = extractCategory(line);
        pendingNotes = [];
        return;
      }

      if (hasTitleMarker(line)) {
        finalizeProduct(current, list);
        current = {
          title: cleanTitle(line),
          category: category,
          specs: pendingNotes.slice(),
          priceOriginal: 0,
          priceText: "",
          stock: ""
        };
        pendingNotes = [];
        return;
      }

      if (!current) {
        if (!isStatusLine(line) && !/UPDATE PRICELIST/i.test(line)) {
          pendingNotes.push(line);
        }
        return;
      }

      if (isStatusLine(line)) {
        return;
      }

      var price = parsePriceLine(line);
      if (price !== null) {
        current.priceOriginal = price;
        current.priceText = line;
        return;
      }

      var stock = parseStockLine(line);
      if (stock !== null) {
        current.stock = stock;
        return;
      }

      current.specs.push(line);
    });

    finalizeProduct(current, list);
    return list;
  }

  function productKey(product) {
    return [product.category || "", product.title || ""].join("|").toLowerCase();
  }

  function collectCurrentOverrides() {
    products.forEach(function (product) {
      storedOverrides[productKey(product)] = product.priceEdited;
    });
  }

  function applyOverrides(nextProducts) {
    nextProducts.forEach(function (product) {
      var key = productKey(product);
      if (storedOverrides[key] !== undefined) {
        product.priceEdited = Number(storedOverrides[key]) || product.priceOriginal;
      }
    });
  }

  function formatCurrency(value) {
    var number = Number(value || 0);
    if (!number) {
      return "-";
    }
    return "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(number));
  }

  function formatInputCurrency(value) {
    return value ? formatCurrency(value) : "";
  }

  function parseEditablePrice(value) {
    return parseCurrency(value);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function csvCell(value) {
    var text = String(value === null || value === undefined ? "" : value);
    return "\"" + text.replace(/"/g, "\"\"") + "\"";
  }

  function getVisibleProducts() {
    var keyword = elements.searchInput.value.trim().toLowerCase();
    var category = elements.categoryFilter.value;

    return products.filter(function (product) {
      var haystack = [
        product.title,
        product.category,
        product.processor,
        product.ram,
        product.storage,
        product.vga,
        product.screen,
        product.specs.join(" ")
      ].join(" ").toLowerCase();

      return (!category || product.category === category) && (!keyword || haystack.indexOf(keyword) !== -1);
    });
  }

  function buildCsv(rows) {
    var headers = [
      "no",
      "kategori",
      "judul",
      "processor",
      "ram",
      "storage",
      "vga",
      "layar",
      "stock",
      "harga_awal",
      "harga_edit",
      "spesifikasi"
    ];

    var body = rows.map(function (product, index) {
      return [
        index + 1,
        product.category,
        product.title,
        product.processor,
        product.ram,
        product.storage,
        product.vga,
        product.screen,
        product.stock,
        product.priceOriginal,
        product.priceEdited,
        product.specs.join(" | ")
      ];
    });

    return [headers].concat(body)
      .map(function (row) {
        return row.map(csvCell).join(",");
      })
      .join("\r\n");
  }

  function buildSpecList(product, limit) {
    var core = [product.processor, product.ram, product.storage, product.vga, product.screen]
      .filter(Boolean);
    var extra = product.specs.filter(function (line) {
      return core.indexOf(line) === -1;
    });

    return core.concat(extra).slice(0, limit || 7);
  }

  function renderStats() {
    var prices = products
      .map(function (product) {
        return Number(product.priceEdited || product.priceOriginal || 0);
      })
      .filter(Boolean);
    var totalStock = products.reduce(function (sum, product) {
      return sum + (Number(product.stock) || 0);
    }, 0);

    elements.totalItems.textContent = products.length;
    elements.totalStock.textContent = new Intl.NumberFormat("id-ID").format(totalStock);
    elements.lowestPrice.textContent = prices.length ? formatCurrency(Math.min.apply(Math, prices)) : "-";
  }

  function syncCategoryOptions() {
    var selected = elements.categoryFilter.value;
    var categories = Array.from(new Set(products.map(function (product) {
      return product.category || "LAINNYA";
    }))).sort();

    elements.categoryFilter.innerHTML = "<option value=\"\">Semua</option>" + categories.map(function (category) {
      return "<option value=\"" + escapeHtml(category) + "\">" + escapeHtml(category) + "</option>";
    }).join("");

    if (categories.indexOf(selected) !== -1) {
      elements.categoryFilter.value = selected;
    }
  }

  function renderTable(rows) {
    if (!rows.length) {
      elements.resultBody.innerHTML = "<tr><td colspan=\"7\" class=\"empty-state\">Tidak ada data yang cocok.</td></tr>";
      return;
    }

    elements.resultBody.innerHTML = rows.map(function (product, index) {
      var specs = [product.processor, product.ram, product.storage, product.vga]
        .filter(Boolean)
        .map(function (line) {
          return "<span>" + escapeHtml(line) + "</span>";
        })
        .join("");
      var stockText = product.stock === "" ? "-" : product.stock + " unit";

      return [
        "<tr>",
        "<td>" + (index + 1) + "</td>",
        "<td class=\"title-cell\"><strong>" + escapeHtml(product.title) + "</strong><span>" + escapeHtml(product.category) + "</span></td>",
        "<td><div class=\"spec-stack\">" + (specs || "<span class=\"muted\">-</span>") + "</div></td>",
        "<td>" + escapeHtml(product.screen || "-") + "</td>",
        "<td><span class=\"stock-badge\">" + escapeHtml(stockText) + "</span></td>",
        "<td>" + escapeHtml(formatCurrency(product.priceOriginal)) + "</td>",
        "<td><input class=\"price-input\" data-key=\"" + escapeHtml(productKey(product)) + "\" value=\"" + escapeHtml(formatInputCurrency(product.priceEdited)) + "\"></td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function renderPromo(rows) {
    if (!rows.length) {
      elements.promoGrid.innerHTML = "<div class=\"empty-card\">Belum ada preview.</div>";
      return;
    }

    elements.promoGrid.innerHTML = rows.map(function (product) {
      var specs = buildSpecList(product, 6).map(function (line) {
        return "<li>" + escapeHtml(line) + "</li>";
      }).join("");
      var stock = product.stock === "" ? "Ready stock" : "Stock " + product.stock + " unit";

      return [
        "<article class=\"promo-card\">",
        "<h3>" + escapeHtml(product.title) + "</h3>",
        "<ul>" + specs + "</ul>",
        "<div class=\"promo-meta\">",
        "<span class=\"stock-badge\">" + escapeHtml(stock) + "</span>",
        "<strong class=\"promo-price\">" + escapeHtml(formatCurrency(product.priceEdited || product.priceOriginal)) + "</strong>",
        "</div>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderCsv(rows) {
    elements.csvOutput.value = buildCsv(rows);
  }

  function render() {
    var rows = getVisibleProducts();
    var status = products.length
      ? products.length + " item terbaca, " + rows.length + " tampil."
      : "Belum ada data diproses.";

    renderStats();
    renderTable(rows);
    renderCsv(rows);
    renderPromo(rows);
    elements.parseStatus.textContent = status;
  }

  function parseNow() {
    collectCurrentOverrides();
    products = parseLaptopData(elements.rawInput.value);
    applyOverrides(products);
    syncCategoryOptions();
    render();
    saveState();
  }

  function scheduleParse() {
    window.clearTimeout(autoParseTimer);
    autoParseTimer = window.setTimeout(parseNow, AUTO_PARSE_DELAY);
  }

  function updatePriceByKey(key, value, formatAfter) {
    var price = parseEditablePrice(value);
    var product = products.find(function (item) {
      return productKey(item) === key;
    });

    if (!product) {
      return;
    }

    product.priceEdited = price || 0;
    storedOverrides[key] = product.priceEdited;
    if (formatAfter) {
      var input = elements.resultBody.querySelector("[data-key=\"" + CSS.escape(key) + "\"]");
      if (input) {
        input.value = formatInputCurrency(product.priceEdited);
      }
    }
    renderStats();
    renderCsv(getVisibleProducts());
    renderPromo(getVisibleProducts());
    saveState();
  }

  function applyPercent() {
    var percent = Number(String(elements.percentInput.value || "0").replace(",", "."));
    var base = elements.percentBase.value;

    if (!Number.isFinite(percent)) {
      percent = 0;
    }

    products.forEach(function (product) {
      var source = base === "edited" ? product.priceEdited : product.priceOriginal;
      var nextPrice = Number(source || 0) * (1 + percent / 100);
      product.priceEdited = Math.round(nextPrice / 1000) * 1000;
      storedOverrides[productKey(product)] = product.priceEdited;
    });

    render();
    saveState();
  }

  function applyValueMarkup() {
    var value = Number(String(elements.valueInput.value || "0").replace(/[^\d]/g, ""));
    var base = elements.percentBase.value;

    if (!Number.isFinite(value) || value === 0) return;

    products.forEach(function (product) {
      var source = base === "edited" ? product.priceEdited : product.priceOriginal;
      product.priceEdited = Math.round((Number(source || 0) + value) / 1000) * 1000;
      storedOverrides[productKey(product)] = product.priceEdited;
    });

    render();
    saveState();
  }

  function resetPrices() {
    products.forEach(function (product) {
      product.priceEdited = product.priceOriginal;
      storedOverrides[productKey(product)] = product.priceEdited;
    });
    render();
    saveState();
  }

  function getBaseHref() {
    try {
      return new URL(".", window.location.href).href;
    } catch (error) {
      return "";
    }
  }

  function resolveLogoSrc() {
    if (logoDataUrl) {
      return Promise.resolve(logoDataUrl);
    }

    if (logoLoadPromise) {
      return logoLoadPromise;
    }

    logoLoadPromise = new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          canvas.getContext("2d").drawImage(image, 0, 0);
          logoDataUrl = canvas.toDataURL("image/png");
          resolve(logoDataUrl);
        } catch (error) {
          resolve(logoPath);
        }
      };
      image.onerror = function () {
        resolve(logoPath);
      };
      image.src = logoPath;
    });

    return logoLoadPromise;
  }

  function resolveLogoPdfImage() {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", logoPath, true);
      xhr.responseType = "blob";
      xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 0) {
          var reader = new FileReader();
          reader.onload = function () {
            var dataUrl = reader.result;
            var img = new Image();
            img.onload = function () {
              resolve({
                dataUrl: dataUrl,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height
              });
            };
            img.onerror = function () { resolve(null); };
            img.src = dataUrl;
          };
          reader.onerror = function () { resolveCanvas(); };
          reader.readAsDataURL(xhr.response);
        } else {
          resolveCanvas();
        }
      };
      xhr.onerror = resolveCanvas;
      xhr.send();

      function resolveCanvas() {
        resolveLogoSrc().then(function (dataUrl) {
          if (!dataUrl || dataUrl === logoPath) { resolve(null); return; }
          var img = new Image();
          img.onload = function () {
            try {
              var width = img.naturalWidth || img.width;
              var height = img.naturalHeight || img.height;
              var scale = Math.min(1, logoPreviewMaxWidth / width, logoPreviewMaxHeight / height);
              var cw = Math.max(1, Math.round(width * scale));
              var ch = Math.max(1, Math.round(height * scale));
              var canvas = document.createElement("canvas");
              canvas.width = cw;
              canvas.height = ch;
              canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
              resolve({
                dataUrl: canvas.toDataURL("image/jpeg", 0.92),
                width: cw,
                height: ch
              });
            } catch (e) { resolve(null); }
          };
          img.onerror = function () { resolve(null); };
          img.src = dataUrl;
        });
      }
    });
  }

  function buildStoreInfoBlock(logoSrc) {
    return [
      "<section class=\"identity\">",
      "<div class=\"identity-head\">",
      "<img class=\"identity-logo\" src=\"" + escapeHtml(logoSrc) + "\" alt=\"" + escapeHtml(storeInfo.name) + "\" onerror=\"this.style.display='none'; this.parentNode.querySelector('.identity-logo-fallback').style.display='flex';\">",
      "<div class=\"identity-logo-fallback\" role=\"img\" aria-label=\"Service Komputer Surabaya ID\">Service Komputer Surabaya ID</div>",
      "</div>",
      "<div class=\"identity-body\">",
      "<p>" + escapeHtml(storeInfo.address) + "</p>",
      "<p>" + escapeHtml(storeInfo.phone) + "</p>",
      "<p>Web: <a href=\"" + escapeHtml(storeInfo.web) + "\">" + escapeHtml(storeInfo.web) + "</a></p>",
      "<p class=\"trust-copy\">" + escapeHtml(storeInfo.trustText) + "</p>",
      "<p>" + escapeHtml(storeInfo.hours) + "</p>",
      "</div>",
      "</div>",
      "</section>"
    ].join("");
  }

  function buildPromoHtml(rows, options) {
    options = options || {};
    var baseHref = getBaseHref();
    var logoSrc = options.logoSrc || logoPath;
    var cards = rows.map(function (product) {
      var specs = buildSpecList(product, 7).map(function (line) {
        return "<li>" + escapeHtml(line) + "</li>";
      }).join("");
      var stock = product.stock === "" ? "Ready stock" : "Stock " + escapeHtml(product.stock) + " unit";

      return [
        "<article class=\"card\">",
        "<p class=\"category\">" + escapeHtml(product.category) + "</p>",
        "<h2>" + escapeHtml(product.title) + "</h2>",
        "<ul>" + specs + "</ul>",
        "<div class=\"meta\">",
        "<span>" + stock + "</span>",
        "<strong>" + escapeHtml(formatCurrency(product.priceEdited || product.priceOriginal)) + "</strong>",
        "</div>",
        "</article>"
      ].join("");
    }).join("\n");

    return [
      "<!doctype html>",
      "<html lang=\"id\">",
      "<head>",
      "<meta charset=\"utf-8\">",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
      baseHref ? "<base href=\"" + escapeHtml(baseHref) + "\">" : "",
      "<title>Promo Laptop</title>",
      "<style>",
      ":root{font-family:Arial,sans-serif;color:#172033;background:#f4f6f8}",
      "*{box-sizing:border-box}",
      "body{margin:0;background:#f4f6f8;color:#172033}",
      "a{color:inherit}",
      ".wrap{max-width:1180px;margin:0 auto}",
      ".identity{margin:0 18px;padding:0 0 8px;background:transparent}",
      ".identity-head{display:flex;flex-direction:column;align-items:flex-start;gap:8px}",
      ".identity-logo{display:block;width:clamp(220px, 40vw, 540px);max-height:210px;flex-shrink:0;object-fit:contain;padding:0;background:transparent;box-shadow:none}",
      ".identity-logo-fallback{display:none;align-items:center;justify-content:center;min-height:48px;padding:0;color:#0f766e;font-size:17px;font-weight:700;letter-spacing:.2px;text-align:left;background:transparent;box-shadow:none;border:0}",
      ".identity-body{min-width:0;margin-top:4px}",
      ".identity p{margin:0;color:#36505b;font-size:14px;line-height:1.5}",
      ".identity .trust-copy{margin-top:5px;font-weight:700;color:#115e59}",
      ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;padding:18px}",
      ".card{display:grid;gap:10px;border:0;border-radius:10px;background:#ffffff;padding:14px;box-shadow:none}",
      ".category{margin:0;color:#0f766e;font-size:12px;font-weight:700;text-transform:uppercase}",
      "h2{margin:0;font-size:18px;line-height:1.3}",
      "ul{display:grid;gap:5px;margin:0;padding-left:20px;color:#344054;font-size:14px}",
      ".meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:auto;border-top:1px solid #d9e0e8;padding-top:10px}",
      ".meta span{border-radius:999px;background:#fff7ed;color:#c2410c;padding:5px 10px;font-weight:700}",
      ".meta strong{color:#115e59;font-size:20px}",
      "@page{size:A4;margin:10mm}",
      "@media print{body{background:white}.wrap{max-width:none}.identity,.card{box-shadow:none}.identity{margin:0}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:12px 0}.card{break-inside:avoid;padding:10px}.identity p,ul{font-size:11px}.identity-logo{width:240px;max-height:160px;padding:4px}.meta strong{font-size:15px}h2{font-size:14px}}",
      "@media(max-width:560px){.grid{padding:12px}.identity{margin:12px}}",
      "</style>",
      "</head>",
      "<body>",
      "<main class=\"wrap\">",
      buildStoreInfoBlock(logoSrc),
      "<section class=\"grid\">",
      cards || "<p>Belum ada data.</p>",
      "</section></main>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  function asciiText(value) {
    return normalizeCommonText(value)
      .replace(/\u00b0/g, " derajat")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function pdfEscape(value) {
    return asciiText(value)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  function measurePdfText(text, fontSize) {
    return asciiText(text).split("").reduce(function (sum, char) {
      if (char === " ") {
        return sum + fontSize * 0.26;
      }
      if ("mwMWGHKNOQRU@#%&".indexOf(char) !== -1) {
        return sum + fontSize * 0.95;
      }
      if ("il.,'|!-:;()/I".indexOf(char) !== -1) {
        return sum + fontSize * 0.28;
      }
      return sum + fontSize * 0.70;
    }, 0);
  }

  function wrapPdfText(text, maxWidth, fontSize, maxLines) {
    var words = asciiText(text).split(/\s+/).filter(Boolean);
    var lines = [];
    var current = "";

    words.forEach(function (word) {
      var next = current ? current + " " + word : word;
      if (measurePdfText(next, fontSize) <= maxWidth) {
        current = next;
        return;
      }
      if (current) {
        lines.push(current);
      }
      current = word;
    });

    if (current) {
      lines.push(current);
    }

    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+$/, "") + "...";
    }

    return lines;
  }

  function dataUrlToHex(dataUrl) {
    var base64 = String(dataUrl || "").split(",")[1] || "";
    var binary = atob(base64);
    var hex = "";

    for (var index = 0; index < binary.length; index += 1) {
      hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
    }

    return hex + ">";
  }

  function buildPdfDocument(rows, logoImage) {
    var pageWidth = 595.28;
    var pageHeight = 841.89;
    var margin = 32;
    var gap = 10;
    var cardWidth = (pageWidth - margin * 2 - gap) / 2;
    var cardHeight = 132;
    var objects = [];
    var pageIds = [];
    var pagesId;
    var fontId;
    var fontBoldId;
    var imageId = null;
    var commands = [];
    var y = pageHeight - margin;
    var hasFirstPageTop = false;

    function addObject(body) {
      objects.push(body);
      return objects.length;
    }

    function reserveObject() {
      objects.push("");
      return objects.length;
    }

    function point(value) {
      return Number(value).toFixed(2).replace(/\.00$/, "");
    }

    function rect(x, bottom, width, height, fillColor, strokeColor) {
      if (fillColor) {
        commands.push(fillColor + " rg");
        commands.push([point(x), point(bottom), point(width), point(height), "re f"].join(" "));
      }
      if (strokeColor) {
        commands.push(strokeColor + " RG");
        commands.push("0.7 w");
        commands.push([point(x), point(bottom), point(width), point(height), "re S"].join(" "));
      }
    }

    function text(x, baseline, value, size, options) {
      options = options || {};
      var color = options.color || "0.13 0.16 0.21";
      var font = options.bold ? "F2" : "F1";
      commands.push(color + " rg");
      commands.push("BT /" + font + " " + point(size) + " Tf 1 0 0 1 " + point(x) + " " + point(baseline) + " Tm (" + pdfEscape(value) + ") Tj ET");
    }

    function image(x, bottom, width, height) {
      if (!imageId) {
        return;
      }
      commands.push("q");
      commands.push([point(width), "0 0", point(height), point(x), point(bottom), "cm /Logo Do"].join(" "));
      commands.push("Q");
    }

    function finishPage() {
      if (!commands.length) {
        return;
      }

      var stream = commands.join("\n");
      var contentId = addObject("<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream");
      var resources = "<< /Font << /F1 " + fontId + " 0 R /F2 " + fontBoldId + " 0 R >>";
      if (imageId) {
        resources += " /XObject << /Logo " + imageId + " 0 R >>";
      }
      resources += " >>";
      pageIds.push(addObject("<< /Type /Page /Parent " + pagesId + " 0 R /MediaBox [0 0 " + point(pageWidth) + " " + point(pageHeight) + "] /Resources " + resources + " /Contents " + contentId + " 0 R >>"));
      commands = [];
      y = pageHeight - margin;
    }

    function newPage() {
      finishPage();
    }

    function drawLogoAndContact() {
      if (hasFirstPageTop) {
        return;
      }
      hasFirstPageTop = true;

      var infoX = margin;
      var topY = pageHeight - 24;

      if (logoImage && imageId) {
        var lw = Math.min(110, Math.max(70, logoImage.width));
        var lh = Math.round(lw * (logoImage.height / logoImage.width));
        if (lh > 60) { lh = 60; lw = Math.round(lh * (logoImage.width / logoImage.height)); }
        text(infoX + 2, topY - lh - 6, "Service Komputer Surabaya ID", 10, { bold: true, color: "0.06 0.46 0.43" });
        image(infoX, topY - lh, lw, lh);
        y = topY - lh - 22;
      } else {
        text(infoX, topY, "Service Komputer Surabaya ID", 13, { bold: true, color: "0.06 0.46 0.43" });
        y = topY - 28;
      }

      var contactMaxWidth = pageWidth - margin * 2 - 16;
      var contactLines = [
        { text: storeInfo.address, size: 8.3 },
        { text: storeInfo.phone, size: 8.3 },
        { text: "Web: " + storeInfo.web, size: 8.3 }
      ];
      wrapPdfText(storeInfo.trustText, contactMaxWidth, 8.8, 2).forEach(function (line) {
        contactLines.push({ text: line, size: 8.8, bold: true, color: "0.07 0.37 0.35" });
      });
      wrapPdfText(storeInfo.hours, contactMaxWidth, 8.3, 2).forEach(function (line) {
        contactLines.push({ text: line, size: 8.3 });
      });

      var wl = [];
      contactLines.forEach(function (line) {
        wrapPdfText(line.text, contactMaxWidth, line.size, 2).forEach(function (w) {
          wl.push({ text: w, size: line.size, bold: line.bold, color: line.color });
        });
      });

      wl.forEach(function (line, i) {
        text(infoX, y - i * 10.5, line.text, line.size, {
          bold: line.bold,
          color: line.color || "0.2 0.25 0.32"
        });
      });

      y = y - wl.length * 10.5 - 8;
      commands.push("0.85 0.88 0.91 RG 1 w " + point(margin) + " " + point(y) + " m " + point(pageWidth - margin) + " " + point(y) + " l S");
      y = y - 14;
    }

    function drawCard(product, x, top) {
      var bottom = top - cardHeight;
      var padding = 9;
      rect(x, bottom, cardWidth, cardHeight, "1 1 1", "0.88 0.92 0.91");
      text(x + padding, top - 16, product.category || "LAPTOP", 7.2, { bold: true, color: "0.06 0.46 0.43" });

      var titleLines = wrapPdfText(product.title, cardWidth - padding * 2, 10.2, 2);
      titleLines.forEach(function (line, index) {
        text(x + padding, top - 31 - index * 12, line, 10.2, { bold: true, color: "0.07 0.09 0.13" });
      });

      var specTop = top - 58;
      buildSpecList(product, 5).forEach(function (line, index) {
        wrapPdfText("- " + line, cardWidth - padding * 2, 7.6, 1).forEach(function (wrappedLine) {
          text(x + padding, specTop - index * 10, wrappedLine, 7.6, { color: "0.24 0.29 0.36" });
        });
      });

      var separatorY = bottom + 26;
      commands.push("0.85 0.88 0.91 RG 1 w " + point(x + padding) + " " + point(separatorY) + " m " + point(x + cardWidth - padding) + " " + point(separatorY) + " l S");

      var stockText = product.stock === "" ? "Ready stock" : "Stock " + product.stock + " unit";
      var stockWidth = measurePdfText(stockText, 7.2) + 12;
      var stockBadgeY = separatorY - 18;
      rect(x + padding, stockBadgeY, stockWidth, 14, "1.0 0.97 0.93", null);
      text(x + padding + 5, stockBadgeY + 4, stockText, 7.2, { bold: true, color: "0.76 0.25 0.05" });

      var priceText = formatCurrency(product.priceEdited || product.priceOriginal);
      var priceWidth = measurePdfText(priceText, 11.5);
      text(x + cardWidth - padding - priceWidth, stockBadgeY + 4, priceText, 11.5, { bold: true, color: "0.07 0.37 0.35" });
    }

    pagesId = reserveObject();
    fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    fontBoldId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

    if (logoImage && logoImage.dataUrl) {
      var logoHex = dataUrlToHex(logoImage.dataUrl);
      imageId = addObject("<< /Type /XObject /Subtype /Image /Width " + logoImage.width + " /Height " + logoImage.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length " + logoHex.length + " >>\nstream\n" + logoHex + "\nendstream");
    }

    drawLogoAndContact();

    rows.forEach(function (product, index) {
      var column = index % 2;
      if (column === 0 && y - cardHeight < margin) {
        newPage();
      }
      drawCard(product, margin + column * (cardWidth + gap), y);
      if (column === 1 || index === rows.length - 1) {
        y -= cardHeight + gap;
      }
    });

    finishPage();
    objects[pagesId - 1] = "<< /Type /Pages /Kids [" + pageIds.map(function (id) {
      return id + " 0 R";
    }).join(" ") + "] /Count " + pageIds.length + " >>";
    var catalogId = addObject("<< /Type /Catalog /Pages " + pagesId + " 0 R >>");

    var pdf = "%PDF-1.4\n";
    var offsets = [0];
    objects.forEach(function (body, index) {
      offsets.push(pdf.length);
      pdf += (index + 1) + " 0 obj\n" + body + "\nendobj\n";
    });

    var xrefOffset = pdf.length;
    pdf += "xref\n0 " + (objects.length + 1) + "\n";
    pdf += "0000000000 65535 f \n";
    for (var offsetIndex = 1; offsetIndex < offsets.length; offsetIndex += 1) {
      pdf += String(offsets[offsetIndex]).padStart(10, "0") + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root " + catalogId + " 0 R >>\n";
    pdf += "startxref\n" + xrefOffset + "\n%%EOF";

    return pdf;
  }

  function downloadText(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 250);
  }

  function exportPdf() {
    var rows = getVisibleProducts();
    elements.parseStatus.textContent = "Menyiapkan PDF clean...";

    resolveLogoPdfImage().then(function (logoImage) {
      var pdf = buildPdfDocument(rows, logoImage);
      downloadText("promo-laptop-" + timestamp() + ".pdf", pdf, "application/pdf");
      elements.parseStatus.textContent = "PDF clean sudah diunduh.";
    });
  }

  function timestamp() {
    var now = new Date();
    var pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "-",
      pad(now.getHours()),
      pad(now.getMinutes())
    ].join("");
  }

  function copyCsv() {
    var csv = elements.csvOutput.value;
    if (!csv) {
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(csv).then(function () {
        elements.parseStatus.textContent = "CSV tersalin.";
      }).catch(function () {
        elements.csvOutput.select();
        document.execCommand("copy");
      });
      return;
    }

    elements.csvOutput.select();
    document.execCommand("copy");
    elements.parseStatus.textContent = "CSV tersalin.";
  }

  function saveState() {
    var payload = {
      raw: elements.rawInput.value,
      overrides: storedOverrides,
      percent: elements.percentInput.value,
      percentBase: elements.percentBase.value,
      search: elements.searchInput.value,
      category: elements.categoryFilter.value,
      activeView: activeView
    };

    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Browser private mode can block localStorage.
    }
  }

  function loadState() {
    try {
      var payload = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      storedOverrides = payload.overrides || {};
      elements.rawInput.value = payload.raw || "";
      elements.percentInput.value = payload.percent || "0";
      elements.percentBase.value = payload.percentBase || "original";
      elements.searchInput.value = payload.search || "";
      activeView = payload.activeView || "table";
    } catch (error) {
      storedOverrides = {};
    }
  }

  function setActiveView(view) {
    activeView = view;
    Object.keys(elements.views).forEach(function (key) {
      elements.views[key].classList.toggle("active", key === view);
    });
    elements.tabButtons.forEach(function (button) {
      var isActive = button.dataset.view === view;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    saveState();
  }

  elements.rawInput.addEventListener("input", scheduleParse);
  elements.parseButton.addEventListener("click", parseNow);
  elements.clearButton.addEventListener("click", function () {
    products = [];
    storedOverrides = {};
    elements.rawInput.value = "";
    elements.searchInput.value = "";
    elements.categoryFilter.value = "";
    render();
    saveState();
  });
  elements.fileInput.addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    file.text().then(function (text) {
      elements.rawInput.value = text;
      parseNow();
    });
  });
  elements.searchInput.addEventListener("input", function () {
    render();
    saveState();
  });
  elements.categoryFilter.addEventListener("change", function () {
    render();
    saveState();
  });
  elements.percentInput.addEventListener("change", saveState);
  elements.percentBase.addEventListener("change", saveState);
  elements.applyPercentButton.addEventListener("click", applyPercent);
  elements.applyValueButton.addEventListener("click", applyValueMarkup);
  elements.resetPriceButton.addEventListener("click", resetPrices);
  elements.copyCsvButton.addEventListener("click", copyCsv);
  elements.downloadCsvButton.addEventListener("click", function () {
    downloadText("ringkasan-laptop-" + timestamp() + ".csv", "\ufeff" + buildCsv(getVisibleProducts()), "text/csv;charset=utf-8");
  });
  elements.downloadPdfButton.addEventListener("click", exportPdf);
  elements.downloadHtmlButton.addEventListener("click", function () {
    resolveLogoSrc().then(function (logoSrc) {
      downloadText("promo-laptop-" + timestamp() + ".html", buildPromoHtml(getVisibleProducts(), { logoSrc: logoSrc }), "text/html;charset=utf-8");
    });
  });
  elements.resultBody.addEventListener("input", function (event) {
    if (event.target.classList.contains("price-input")) {
      updatePriceByKey(event.target.dataset.key, event.target.value, false);
    }
  });
  elements.resultBody.addEventListener("blur", function (event) {
    if (event.target.classList.contains("price-input")) {
      updatePriceByKey(event.target.dataset.key, event.target.value, true);
    }
  }, true);
  elements.tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setActiveView(button.dataset.view);
    });
  });

  loadState();
  parseNow();
  setActiveView(activeView);
})();
