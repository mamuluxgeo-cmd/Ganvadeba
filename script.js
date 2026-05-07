const API_URL = "https://script.google.com/macros/s/AKfycbySqJN5x9s9OXRVIZG59ufqhw2pyP14FoxuLz6g2MBODRfJsfG6hwsY5mhleOk4cS5HZQ/exec";

let currentUser = null;
let controlData = [];
let contractsData = [];
let settings = {};
let lastPreviewHtml = "";

document.addEventListener("DOMContentLoaded", () => {
  setTodayDefaults();
  bindEvents();
  restoreSession();
});

function bindEvents() {
  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("refreshBtn").addEventListener("click", loadAllData);

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  document.getElementById("previewContractBtn").addEventListener("click", previewContract);
  document.getElementById("saveNewContractBtn").addEventListener("click", saveNewContract);
  document.getElementById("saveOldInstallmentBtn").addEventListener("click", saveOldInstallment);

  document.getElementById("downloadPdfBtn").addEventListener("click", downloadContractPdf);
  document.getElementById("printContractBtn").addEventListener("click", () => window.print());

  document.getElementById("reloadControlBtn").addEventListener("click", loadControl);
  document.getElementById("reloadContractsBtn").addEventListener("click", loadContracts);

  document.getElementById("controlSearch").addEventListener("input", renderControl);
  document.getElementById("contractsSearch").addEventListener("input", renderContracts);

  document.getElementById("confirmPaymentBtn").addEventListener("click", confirmPayment);

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", closeModals);
  });

  document.getElementById("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
}

function setTodayDefaults() {
  const today = toInputDate(new Date());

  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) input.value = today;
  });
}

async function api(action, payload = {}) {
  const body = {
    action,
    ...payload
  };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("API პასუხი JSON არ არის: " + text);
  }
}

async function login() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const msg = document.getElementById("loginMessage");

  msg.textContent = "";

  if (!username || !password) {
    msg.textContent = "შეიყვანე მომხმარებელი და პაროლი";
    return;
  }

  try {
    setLoading(true);
    const result = await api("login", { username, password });

    if (!result.success) {
      msg.textContent = result.message || "შესვლა ვერ მოხერხდა";
      return;
    }

    currentUser = result.user;
    localStorage.setItem("installment_user", JSON.stringify(currentUser));
    openMain();

  } catch (err) {
    msg.textContent = err.message;
  } finally {
    setLoading(false);
  }
}

function restoreSession() {
  const saved = localStorage.getItem("installment_user");
  if (!saved) return;

  try {
    currentUser = JSON.parse(saved);
    openMain();
  } catch {
    localStorage.removeItem("installment_user");
  }
}

async function openMain() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainView").classList.remove("hidden");

  document.getElementById("userRoleText").textContent =
    currentUser.role === "admin" ? "ადმინი" : "მოლარე";

  applyRoleAccess();
  await loadAllData();
}

function logout() {
  currentUser = null;
  localStorage.removeItem("installment_user");

  document.getElementById("mainView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}

function applyRoleAccess() {
  const isAdmin = currentUser && currentUser.role === "admin";

  document.querySelectorAll(".admin-only").forEach(el => {
    el.classList.toggle("hidden", !isAdmin);
  });

  if (!isAdmin) {
    showView("newContractView");
  } else {
    showView("dashboardView");
  }
}

function showView(viewId) {
  document.querySelectorAll(".page-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  const titles = {
    dashboardView: ["დეშბორდი", "საერთო ფინანსური სურათი"],
    newContractView: ["ახალი ხელშეკრულება", "ხელშეკრულება + გრაფიკი A4 ფორმატში"],
    oldInstallmentView: ["ძველი განვადება", "უკვე არსებული განვადებების კონტროლში დამატება"],
    controlView: ["გადახდების კონტროლი", "გადასახდელები, დაგვიანებები და გადახდების დამატება"],
    contractsView: ["ხელშეკრულებები", "შენახული ხელშეკრულებების ბაზა"]
  };

  document.getElementById("pageTitle").textContent = titles[viewId][0];
  document.getElementById("pageSubtitle").textContent = titles[viewId][1];
}

async function loadAllData() {
  try {
    setLoading(true);
    await loadSettings();
    await loadContracts();
    await loadControl();
  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function loadSettings() {
  const result = await api("getSettings");
  if (result.success) {
    settings = result.data || {};
  }
}

async function loadContracts() {
  const result = await api("getContracts");

  if (!result.success) {
    toast(result.message || "ხელშეკრულებები ვერ ჩაიტვირთა", true);
    return;
  }

  contractsData = result.data || [];
  renderContracts();
}

async function loadControl() {
  const result = await api("getControlData");

  if (!result.success) {
    toast(result.message || "Control ვერ ჩაიტვირთა", true);
    return;
  }

  controlData = result.data || [];
  renderControl();
  renderDashboard();
}

function renderDashboard() {
  const totalContracts = controlData.length;
  const totalRemaining = controlData.reduce((s, r) => s + num(r["სულ დარჩენილი"]), 0);
  const overdue = controlData.reduce((s, r) => s + num(r["დაგვიანებული თანხა"]), 0);
  const dueToday = controlData.filter(r => r["სტატუსი"] === "Due Today").length;

  document.getElementById("statContracts").textContent = totalContracts;
  document.getElementById("statRemaining").textContent = money(totalRemaining);
  document.getElementById("statOverdue").textContent = money(overdue);
  document.getElementById("statDueToday").textContent = dueToday;

  const rows = [...controlData]
    .filter(r => num(r["სულ დარჩენილი"]) > 0)
    .sort((a, b) => parseDateGeo(a["შემდეგი გადახდის თარიღი"]) - parseDateGeo(b["შემდეგი გადახდის თარიღი"]))
    .slice(0, 8);

  document.getElementById("dashboardRows").innerHTML = rows.map(r => `
    <tr>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["შემდეგი გადახდის თარიღი"])}</td>
      <td>${money(r["შემდეგი გადასახდელი"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
    </tr>
  `).join("") || emptyRow(5);
}

function renderControl() {
  const q = document.getElementById("controlSearch").value.toLowerCase().trim();

  const rows = controlData.filter(r => {
    const text = [
      r["კლიენტი"],
      r["პირადი ნომერი"],
      r["ტელეფონი"],
      r["პროდუქცია"],
      r["Contract ID"]
    ].join(" ").toLowerCase();

    return text.includes(q);
  });

  document.getElementById("controlRows").innerHTML = rows.map(r => `
    <tr>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["პროდუქცია"])}</td>
      <td>${money(r["სრული თანხა"])}</td>
      <td>${money(r["სულ გადახდილი"])}</td>
      <td><strong>${money(r["სულ დარჩენილი"])}</strong></td>
      <td>${safe(r["შემდეგი გადახდის თარიღი"])}</td>
      <td>${money(r["შემდეგი გადასახდელი"])}</td>
      <td>${money(r["დაგვიანებული თანხა"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
      <td>
        <div class="row-actions">
          <button class="small-btn pay" onclick="openPaymentModal('${safeAttr(r["Contract ID"])}','${safeAttr(r["კლიენტი"])}')">გადახდა</button>
          <button class="small-btn view" onclick="openDetails('${safeAttr(r["Contract ID"])}')">ნახვა</button>
        </div>
      </td>
    </tr>
  `).join("") || emptyRow(11);
}

function renderContracts() {
  const q = document.getElementById("contractsSearch").value.toLowerCase().trim();

  const rows = contractsData.filter(r => {
    const text = [
      r["Contract ID"],
      r["ჩანაწერის ტიპი"],
      r["კლიენტი"],
      r["პირადი ნომერი"],
      r["ტელეფონი"],
      r["პროდუქცია"]
    ].join(" ").toLowerCase();

    return text.includes(q);
  });

  const isCashier = currentUser && currentUser.role === "cashier";

  const filtered = isCashier
    ? rows.filter(r => r["შემქმნელი"] === currentUser.username)
    : rows;

  document.getElementById("contractsRows").innerHTML = filtered.map(r => `
    <tr>
      <td>${safe(r["Contract ID"])}</td>
      <td>${safe(r["ჩანაწერის ტიპი"])}</td>
      <td>${safe(r["კლიენტი"])}</td>
      <td>${safe(r["პირადი ნომერი"])}</td>
      <td>${safe(r["ტელეფონი"])}</td>
      <td>${safe(r["პროდუქცია"])}</td>
      <td>${money(r["სრული თანხა"])}</td>
      <td>${statusBadge(r["სტატუსი"])}</td>
      <td>${safe(r["შემქმნელი"])}</td>
      <td>
        <button class="small-btn view" onclick="openDetails('${safeAttr(r["Contract ID"])}')">ნახვა</button>
      </td>
    </tr>
  `).join("") || emptyRow(10);
}

function previewContract() {
  const data = formToObject(document.getElementById("newContractForm"));

  if (!data.buyerName || !data.buyerId || !data.products || !data.totalAmount || !data.months) {
    toast("შეავსე აუცილებელი ველები", true);
    return;
  }

  const html = buildContractHtml(data);
  lastPreviewHtml = html;

  const preview = document.getElementById("contractPreview");
  preview.classList.remove("empty-preview");
  preview.innerHTML = html;
}

async function saveNewContract() {
  const form = document.getElementById("newContractForm");

  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);

    const result = await api("addNewContract", { data });

    if (!result.success) {
      toast(result.message || "შენახვა ვერ მოხერხდა", true);
      return;
    }

    const html = buildContractHtml(data);
    await api("saveContractVersion", {
      data: {
        contractId: result.contractId,
        contractHtml: html,
        createdBy: currentUser.username,
        comment: "პირველი შენახული ვერსია"
      }
    });

    toast("ხელშეკრულება შეინახა: " + result.contractId);
    form.reset();
    setTodayDefaults();

    document.getElementById("contractPreview").classList.add("empty-preview");
    document.getElementById("contractPreview").innerHTML = "შეავსე ფორმა და დააჭირე „წინასწარი ნახვა“";

    await loadAllData();

  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function saveOldInstallment() {
  const form = document.getElementById("oldInstallmentForm");

  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);

    const result = await api("addOldInstallment", { data });

    if (!result.success) {
      toast(result.message || "შენახვა ვერ მოხერხდა", true);
      return;
    }

    toast("ძველი განვადება დაემატა: " + result.contractId);
    form.reset();
    setTodayDefaults();
    await loadAllData();

  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

function openPaymentModal(contractId, buyerName) {
  const form = document.getElementById("paymentForm");

  form.contractId.value = contractId;
  form.buyerName.value = buyerName;
  form.paymentDate.value = toInputDate(new Date());
  form.amount.value = "";
  form.method.value = "ნაღდი";
  form.comment.value = "";

  document.getElementById("paymentModal").classList.remove("hidden");
}

async function confirmPayment() {
  const form = document.getElementById("paymentForm");

  if (!form.reportValidity()) return;

  const data = formToObject(form);
  data.createdBy = currentUser.username;

  try {
    setLoading(true);

    const result = await api("addPayment", { data });

    if (!result.success) {
      toast(result.message || "გადახდა ვერ დაემატა", true);
      return;
    }

    closeModals();
    toast("გადახდა შეინახა");
    await loadAllData();

  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

async function openDetails(contractId) {
  try {
    setLoading(true);

    const result = await api("getContractFull", { contractId });

    if (!result.success) {
      toast(result.message || "დეტალები ვერ მოიძებნა", true);
      return;
    }

    const c = result.contract;
    const schedule = result.schedule || [];
    const payments = result.payments || [];

    document.getElementById("detailsContent").innerHTML = `
      <div class="details-grid">
        <div class="detail-box"><span>ID</span><strong>${safe(c["Contract ID"])}</strong></div>
        <div class="detail-box"><span>კლიენტი</span><strong>${safe(c["კლიენტი"])}</strong></div>
        <div class="detail-box"><span>ტიპი</span><strong>${safe(c["ჩანაწერის ტიპი"])}</strong></div>
        <div class="detail-box"><span>პირადი ნომერი</span><strong>${safe(c["პირადი ნომერი"])}</strong></div>
        <div class="detail-box"><span>ტელეფონი</span><strong>${safe(c["ტელეფონი"])}</strong></div>
        <div class="detail-box"><span>თანხა</span><strong>${money(c["სრული თანხა"])}</strong></div>
      </div>

      <h3>გრაფიკი</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N</th>
              <th>თარიღი</th>
              <th>დასარიცხი</th>
              <th>გადახდილი</th>
              <th>დარჩენილი</th>
              <th>სტატუსი</th>
            </tr>
          </thead>
          <tbody>
            ${schedule.map(s => `
              <tr>
                <td>${safe(s["N"])}</td>
                <td>${safe(s["გადახდის თარიღი"])}</td>
                <td>${money(s["საბოლოო დასარიცხი თანხა"])}</td>
                <td>${money(s["გადახდილი თანხა"])}</td>
                <td>${money(s["დარჩენილი თანხა"])}</td>
                <td>${statusBadge(s["სტატუსი"])}</td>
              </tr>
            `).join("") || emptyRow(6)}
          </tbody>
        </table>
      </div>

      <h3>გადახდები</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>თარიღი</th>
              <th>თანხა</th>
              <th>მეთოდი</th>
              <th>კომენტარი</th>
              <th>დაამატა</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${safe(p["გადახდის თარიღი"])}</td>
                <td>${money(p["თანხა"])}</td>
                <td>${safe(p["მეთოდი"])}</td>
                <td>${safe(p["კომენტარი"])}</td>
                <td>${safe(p["დაამატა"])}</td>
              </tr>
            `).join("") || emptyRow(5)}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("detailsModal").classList.remove("hidden");

  } catch (err) {
    toast(err.message, true);
  } finally {
    setLoading(false);
  }
}

function closeModals() {
  document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
}

function downloadContractPdf() {
  const element = document.getElementById("contractPreview");

  if (!lastPreviewHtml || element.classList.contains("empty-preview")) {
    toast("ჯერ შექმენი წინასწარი ხედი", true);
    return;
  }

  const opt = {
    margin: 0,
    filename: "ganvadebis-khelshekruleba.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  };

  html2pdf().set(opt).from(element).save();
}

function buildContractHtml(data) {
  const buyerName = safe(data.buyerName);
  const buyerId = safe(data.buyerId);
  const phone = safe(data.phone);
  const address = safe(data.address);
  const products = safe(data.products);
  const totalAmount = money(data.totalAmount);
  const advanceAmount = money(data.advanceAmount || 0);
  const installmentAmount = money(num(data.totalAmount) - num(data.advanceAmount));
  const contractDate = formatInputDateGeo(data.contractDate);
  const schedule = buildLocalSchedule(data);

  return `
    <div class="contract-title">
      საყოფაცხოვრებო პროდუქციის (ავეჯი)<br>
      განვადებით ნასყიდობის შესახებ
    </div>

    <div class="contract-top">
      <span>ქ. ბათუმი</span>
      <span>${contractDate} წელი</span>
    </div>

    <p>
      ჩვენ, ქვემოთ ხელის მომწერნი, ერთის მხრივ - შ.პ.ს. ,,ედელვაისი“-ს
      (ს/კ: 448408054) დირექტორი - გიორგი წულუკიძე (პ/ნ 61006068844),
      შემდგომში “გამყიდველი” წოდებული და მეორეს მხრივ ${buyerName}
      (პ/ნ-${buyerId}), შემდგომში ,,მყიველი”, ადასტურებენ, რომ მათ შორის
      მიღწეულია შეთანხმება და აფორმებენ წინამდებარე ხელშეკრულებას შემდეგზე:
    </p>

    <div class="contract-article">მუხლი 1. ხელშეკრულების და ნასყიდობის საგანი</div>
    <p>1.1. წინამდებარე ხელშეკრულების საგანია გამყიდველის საკუთრებაში არსებული საყოფაცხოვრებო პროდუქციის (${products}) მიერ მყიდველისათვის ნასყიდობის საგნის საკუთრების უფლებით გადაცემა ანაზღაურების სანაცვლოდ.</p>
    <p>1.2. საკუთრების უფლება მყიდველისათვის გადაცემულად ითვლება ნასყიდობის საგნის გადაცემასთან ერთად.</p>
    <p>1.3. ნასყიდობის საგანი განისაზღვრება წინამდებარე ხელშეკრულების დანართით, რასაც მყიდველი შეარჩევს გამყიდველის საკუთრებაში არსებულ კონკრეტულ პროდუქციას (შემდგომში - ნასყიდობის საგანი).</p>
    <p>1.4. წინამდებარე ხელშეკრულებით გათვალისწინებული ვალდებულებების სრულად შესრულებამდე მყიდველს უფლება არ აქვს გაასხვისოს, დააზიანოს, ან/და უფლებრივად დატვირთოს ნასყიდობის საგანი.</p>

    <div class="contract-article">მუხლი 2. ნასყიდობის საფასური და გადახდა</div>
    <p>2.1. ნასყიდობის საფასური განისაზღვრება ინდივიდუალურად, მყიდველის მიერ კონკრეტული ნასყიდობის საგნის შერჩევის დროს, დანართის შესაბამისად.</p>
    <p>2.2. ნასყიდობის საფასურის გადახდა ხორციელდება განვადებით. ნასყიდობის საფასური და გადახდის გრაფიკი განისაზღვრება ინდივიდუალურად, წინამდებარე ხელშეკრულების დანართით, რომელიც გამომდინარეობს მყიდველის მიერ შერჩეული კონკრეტული პროდუქციის შესაბამისად, მას შემდეგ, რაც მყიდველი შეარჩევს ნასყიდობის საგანს.</p>
    <p>2.3. გადახდის გრაფიკის ზედიზედ ორჯერ დარღვევის შემთხვევაში, თუკი ვადაგადაცილებული დღეების ოდენობა აღემატება - 15 (თხუთმეტი) კალენდარულ დღეს, გამყიდველი ან/და გამყიდველის უფლებამოსილი პირი უფლებამოსილია შეწყვიტოს ხელშეკრულება მყიდველისათვის სატელეფონო შეტყობინების გაგზავნის გზით, ელ-ფოსტაზე შეტყობინებით და მოითხოვოს გადახდის გრაფიკით განსაზღვრული გადაუხდელი თანხისა და ხელშეკრულებით გათვალისწინებული ყველა სხვა გადასახდელის სრული ოდენობით გადახდა.</p>
    <p>2.4. ვალდებულების შესრულების მიზნით, გამყიდველი ან/და გამყიდველის მიერ უფლებამოსილი პირი უფლებამოსილია დაუკავშირდეს მყიდველს, მათ შორის, სატელეფონო თუ სხვადასხვა სახის შეტყობინების გზით, შეახსენოს ვალდებულების შესრულების თარიღი, გრაფიკის დარღვევის ფაქტი, გამყიდველის მოთხოვნის უფლებები.</p>
    <p>2.5. მყიდველი უფლებამოსილია ვადამდე დაფაროს სრულად გრაფიკით გათვალისწინებული სრული საფასური, რისთვისაც მას არ დაეკისრება დამატებითი საკომისიო ან/და პირგასამტეხლო.</p>

    <div class="contract-article">მუხლი 3. კომუნიკაცია. სასამართლო უწყების ჩაბარება</div>
    <p>3.1. გამყიდველის ან/და გამყიდველის უფლებამოსილი პირის მიერ კომუნიკაცია განხორციელდება შემდეგი საშუალებებით: სატელეფონო კომუნიკაცია; ელ-ფოსტის მეშვეობით კომუნიკაცია; ნასყიდობის საგნის ადგილსამყოფელისა და მისი მდგომარეობის შესამოწმებლად მყიდველის საცხოვრებელ ადგილზე ვიზიტი; მყიდველის მიერ მითითებულ მისამართზე ვიზიტი; ოფიციალური კორესპონდენციის გაგზავნა მყიდველის მიერ მითითებულ მისამართზე.</p>
    <p>3.2. წინამდებარე ხელშეკრულებით გათვალისწინებული საკომუნიკაციო მონაცემები განისაზღვრება დანართით, რომელიც წარმოადგენს ხელშეკრულების განუყოფელ ნაწილს.</p>

    <div class="contract-article">მუხლი 4. დავების გადაწყვეტა</div>
    <p>4.1. მხარეები შეეცდებიან ხელშეკრულებიდან წარმოშობილი დავები გადაწყვიტონ ურთიერთშეთანხმებით.</p>
    <p>4.2. მხარეებს უფლება აქვთ დავის გადასაწყვეტად მიმართონ სასამართლოს საქართველოს სამოქალაქო საპროცესო კოდექსით დადგენილი წესით. პირველი ინსტანციის მიერ მიღებული გადაწყვეტილება ექვემდებარება დაუყოვნებლივ აღსრულებას.</p>

    <div class="contract-article">მუხლი 5. დასკვნითი დებულებები</div>
    <p>5.1. წინამდებარე ხელშეკრულება მოქმედებს მხარეთა მიერ ნაკისრი ვალდებულებების სრულად შესრულებამდე.</p>
    <p>5.2. ამ ხელშეკრულების ნებისმიერი ცვლილება და დამატება ძალაშია მხოლოდ იმ პირობით, თუ ის შედგენილია წერილობითი ფორმით და ხელმოწერილია მხარეთა მიერ ან/და სათანადო რწმუნებულების მქონე წარმომადგენელთა მიერ.</p>
    <p>5.3. ეს ხელშეკრულება შედგენილია ორ იდენტურ ეგზემპლარად, ქართულ ენაზე, რომელიც გადაეცემა მხარეებს და ორივე ეგზემპლიარი თანაბარი იურიდიული ძალის მქონეა.</p>
    <p>5.4. მყიდველი თანახმაა, გამყიდველმა დაამუშაოს წინამდებარე ხელშეკრულებიდან გამომდინარე პერსონალური მონაცემები, მათ შორის, სახელი, გვარი, პირადი ნომერი, დაბადების თარიღი, სამუშაო ადგილი, პროფესია, ოჯახური მდგომარეობა, დაბადების ადგილი, ელ-ფოსტა, ტელეფონის ნომერი, მისამართი, სოციალურ ქსელში არსებული ინფორმაცია, ფოტოსურათი, ალტერნატიული მისამართი, ფინანსური მონაცემები, გადახდასთან დაკავშირებული ინფორმაცია, სქესი, კანონიერი გზებითა და მიზნებით, მათ შორის, ამ ხელშეკრულებით გათვალისწინებული მიზნებისათვის.</p>

    <div class="contract-article">მუხლი 6. მხარეთა ხელმოწერები და რეკვიზიტები</div>

    <div class="signature-grid">
      <div>
        <strong>გამყიდველი:</strong><br>
        შ.პ.ს. ,,ედელვაისი“-ს (ს/კ: 448408054)<br>
        დირექტორი ------------------------------- /გიორგი წულუკიძე/<br>
        მის: ქ. ბათუმი, ლორიას ქუჩა #7<br>
        ელ. ფოსტა: giorgi.tsulukidze94@gmail.com<br>
        ტელ: 557 25-06-06;
      </div>
      <div>
        <strong>მყიველი:</strong><br>
        ----------------------------------- /${buyerName}/<br>
        მის: ${address}<br>
        ტელ: ${phone};
      </div>
    </div>

    <div class="schedule-title">განვადების გრაფიკი</div>

    <p>
      პროდუქციის ღირებულება: <strong>${totalAmount}</strong><br>
      წინასწარი შენატანი: <strong>${advanceAmount}</strong><br>
      განვადებით გადასახდელი თანხა: <strong>${installmentAmount}</strong>
    </p>

    <table class="schedule-table">
      <thead>
        <tr>
          <th>#</th>
          <th>თარიღი</th>
          <th>შესატანი თანხა</th>
          <th>ფულადი ნაშთი</th>
          <th>ბალანსი</th>
        </tr>
      </thead>
      <tbody>
        ${schedule.map(row => `
          <tr>
            <td>${row.n}</td>
            <td>${row.date}</td>
            <td>${money(row.amount)}</td>
            <td>${money(row.remaining)}</td>
            <td>${money(row.balance)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function buildLocalSchedule(data) {
  const months = Math.max(1, Number(data.months || 1));
  const total = round2(num(data.totalAmount) - num(data.advanceAmount));
  const base = round2(total / months);
  const firstDate = data.firstPaymentDate ? new Date(data.firstPaymentDate) : new Date();
  const paymentDay = Number(data.paymentDay || firstDate.getDate());

  let rows = [];
  let generated = 0;
  let balance = total;

  for (let i = 1; i <= months; i++) {
    const d = new Date(firstDate);

    if (i > 1) {
      d.setMonth(d.getMonth() + i - 1);
      d.setDate(paymentDay);
    }

    let amount = base;
    if (i === months) {
      amount = round2(total - generated);
    }

    generated = round2(generated + amount);
    balance = round2(balance - amount);

    rows.push({
      n: i,
      date: formatDateGeo(d),
      amount,
      remaining: Math.max(balance, 0),
      balance: Math.max(balance, 0)
    });
  }

  return rows;
}

function formToObject(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = typeof value === "string" ? value.trim() : value;
  });
  return data;
}

function setLoading(isLoading) {
  document.body.style.cursor = isLoading ? "wait" : "default";
}

function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.style.background = isError ? "#dc2626" : "#111827";
  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, 3500);
}

function safe(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  return safe(value).replaceAll("\n", " ");
}

function num(value) {
  const n = Number(String(value || 0).replaceAll(",", ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return `${round2(num(value)).toLocaleString("ka-GE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ₾`;
}

function statusBadge(status) {
  const map = {
    Active: "აქტიური",
    Closed: "დასრულებული",
    Overdue: "დაგვიანებული",
    "Due Today": "დღეს გადასახდელი",
    Pending: "გადასახდელი",
    Paid: "გადახდილი",
    Partial: "ნაწილობრივი",
    Cancelled: "გაუქმებული"
  };

  const cls = String(status || "Active").replaceAll(" ", "");
  return `<span class="badge ${cls}">${map[status] || safe(status)}</span>`;
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:#6b7280;padding:24px;">მონაცემები არ არის</td></tr>`;
}

function toInputDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateGeo(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}.${m}.${y}`;
}

function formatInputDateGeo(value) {
  if (!value) return formatDateGeo(new Date());
  return formatDateGeo(new Date(value));
}

function parseDateGeo(value) {
  if (!value) return new Date("2999-01-01");

  const str = String(value);

  if (str.includes(".")) {
    const [d, m, y] = str.split(".");
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  return new Date(str);
}
