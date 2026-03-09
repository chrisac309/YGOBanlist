/**
 * App initialization and page navigation for the YGO Banlist GitHub Pages site.
 */
document.addEventListener("DOMContentLoaded", () => {
    let banlistData = null;
    let banlistLoaded = false;

    // Navigation
    const pages = {
        home: document.getElementById("page-home"),
        banlist: document.getElementById("page-banlist")
    };

    const navLinks = document.querySelectorAll("[data-page]");

    function showPage(pageId) {
        for (const [key, el] of Object.entries(pages)) {
            el.style.display = key === pageId ? "block" : "none";
        }
        navLinks.forEach(link => {
            link.classList.toggle("active", link.getAttribute("data-page") === pageId);
        });

        if (pageId === "banlist" && !banlistLoaded) {
            banlistLoaded = true;
            loadBanlist();
        }
    }

    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const page = link.getAttribute("data-page");
            window.location.hash = page === "home" ? "" : page;
            showPage(page);
            // Close mobile nav
            const toggle = document.getElementById("nav-toggle");
            if (toggle.checked) toggle.checked = false;
        });
    });

    // Handle hash-based navigation
    function handleHash() {
        const hash = window.location.hash.replace("#", "");
        if (hash === "banlist") {
            showPage("banlist");
        } else {
            showPage("home");
        }
    }

    window.addEventListener("hashchange", handleHash);
    handleHash();

    // Status filter
    const statusFilter = document.getElementById("status-filter");
    if (statusFilter) {
        statusFilter.addEventListener("change", () => {
            if (banlistData) {
                renderBanlist(banlistData);
            }
        });
    }

    // Load banlist data
    async function loadBanlist() {
        const loading = document.getElementById("loading");
        const results = document.getElementById("results");
        const errorDisplay = document.getElementById("error-display");

        loading.style.display = "block";
        results.style.display = "none";
        errorDisplay.style.display = "none";

        try {
            banlistData = await YGOProDeckClient.getCardPowerFromPastYear((percent, message) => {
                const bar = document.getElementById("progress-bar");
                const text = document.getElementById("loading-text");
                bar.style.width = percent + "%";
                bar.textContent = percent + "%";
                bar.setAttribute("aria-valuenow", percent);
                text.textContent = message;
            });

            loading.style.display = "none";
            results.style.display = "block";
            renderBanlist(banlistData);
        } catch (err) {
            loading.style.display = "none";
            errorDisplay.style.display = "block";
            errorDisplay.textContent = "Failed to load banlist data: " + err.message;
            console.error("Banlist load error:", err);
        }
    }

    // Render banlist table
    function renderBanlist(data) {
        const tbody = document.getElementById("banlist-body");
        const filterValue = document.getElementById("status-filter").value;

        const filtered = filterValue === "all"
            ? data
            : data.filter(card => card.status.replaceAll("*", "") === filterValue);

        tbody.innerHTML = "";

        for (const card of filtered) {
            const row = document.createElement("tr");

            // Image cell
            const imgCell = document.createElement("td");
            const img = document.createElement("img");
            img.src = card.imageUrl;
            img.alt = card.name;
            img.className = "card-image";
            img.loading = "lazy";
            img.onerror = function () {
                this.style.display = "none";
            };
            imgCell.appendChild(img);
            row.appendChild(imgCell);

            // Name cell
            const nameCell = document.createElement("td");
            nameCell.textContent = card.name;
            row.appendChild(nameCell);

            // Power level cell
            const powerCell = document.createElement("td");
            const badge = document.createElement("span");
            badge.className = "badge " + getPowerBadgeClass(card.power);
            badge.textContent = card.power;
            powerCell.appendChild(badge);
            row.appendChild(powerCell);

            // Status cell
            const statusCell = document.createElement("td");
            const statusBadge = document.createElement("span");
            statusBadge.className = "badge " + getStatusBadgeClass(card.status);
            statusBadge.textContent = card.status;
            statusCell.appendChild(statusBadge);
            row.appendChild(statusCell);

            tbody.appendChild(row);
        }
    }

    function getPowerBadgeClass(power) {
        if (power >= 50) return "bg-danger";
        if (power >= 25) return "bg-warning text-dark";
        return "bg-info text-dark";
    }

    function getStatusBadgeClass(status) {
        const base = status.replaceAll("*", "");
        if (base === "BANNED") return "bg-danger";
        if (base === "LIMITED") return "bg-warning text-dark";
        if (base === "SEMI-LIMITED") return "bg-info text-dark";
        return "bg-secondary";
    }
});
