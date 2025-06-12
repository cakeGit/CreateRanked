const fetchChartDataCache = new Map();

async function fetchChartData(apiUrl) {
    if (fetchChartDataCache.has(apiUrl)) {
        return fetchChartDataCache.get(apiUrl);
    }
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        fetchChartDataCache.set(apiUrl, data);
        return data;
    } catch (error) {
        console.error("Failed to fetch chart data:", error);
        return null;
    }
}

let currentEndpoint = '/api/mods.json';
let currentSort = 'downloads';
let currentSortDir = 'desc'; 
let currentMax = 20;
let chartType = 'bar';
let currentSearch = "";

function transformInfoToChartData(rawData, sortKey = "downloads", maxEntries = 20, sortDir = 'desc') {
    // Support both mods and authors endpoints
    const dataKey = rawData.mods ? "mods" : (rawData.authors ? "authors" : null);
    if (!rawData || !rawData[dataKey]) return null;
    let fullItems = [...rawData[dataKey]];

    // Map legacy sort keys to new schema
    const keyMap = {
        downloads: "downloadCount",
        downloadsRate: "downloadRate",
        mods: "mods",
        name: "name",
        time: "daysExisting"
    };
    const mappedSortKey = keyMap[sortKey] || sortKey;

    // Sort full list and assign static rank
    if (mappedSortKey === "name") {
        fullItems.sort((a, b) => sortDir === 'asc'
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name));
    } else {
        fullItems.sort((a, b) => sortDir === 'asc'
            ? (a[mappedSortKey] ?? 0) - (b[mappedSortKey] ?? 0)
            : (b[mappedSortKey] ?? 0) - (a[mappedSortKey] ?? 0));
    }
    // Assign static rank
    fullItems.forEach((item, idx) => item._staticRank = idx + 1);

    // Now filter by search
    let items = [...fullItems];
    if (currentSearch && currentSearch.trim().length > 0) {
        const searchLower = currentSearch.trim().toLowerCase();
        items = items.filter(item =>
            (item.name && item.name.toLowerCase().includes(searchLower)) ||
            (item.author && item.author.toLowerCase().includes(searchLower))
        );
    }

    items = items.slice(0, maxEntries);

    // For authors, show mods count as a dataset if needed
    const isAuthor = !!rawData.authors;

    // Add static rank and author name to each label
    const labels = items.map(item => {
        let label = `#${item._staticRank} `;
        if (item.name) label += item.name;
        if (item.author) label += ` (by ${item.author})`;
        return label;
    });

    const datasets = [
        {
            label: "Download Rate",
            data: items.map(item => item.downloadRate ?? item.downloadrate ?? 0),
            backgroundColor: "rgba(75,192,192,0.6)",
            borderColor: "rgba(75,192,192,1)",
            borderWidth: 1,
            xAxisID: "rate-x",
            sortField: "downloadRate",
            hidden: false // Visible by default
        },
        {
            label: "Downloads",
            data: items.map(item => item.downloadCount ?? item.downloadcount ?? 0),
            backgroundColor: "rgba(245, 140, 28, 0.6)",
            borderColor: "rgba(245, 140, 28, 1)",
            borderWidth: 1,
            xAxisID: "downloads-x",
            sortField: "downloads",
            hidden: true // Hidden by default
        }
    ];

    if (isAuthor) {
        datasets.push({
            label: "Mods",
            data: items.map(item => item.mods ?? 0),
            backgroundColor: "rgba(100, 100, 255, 0.4)",
            borderColor: "rgba(100, 100, 255, 1)",
            borderWidth: 1,
            xAxisID: "mods-x",
            sortField: "mods",
            hidden: true // Hidden by default
        });
    }

    datasets.push({
        label: "Time (days)",
        data: items.map(item => item.daysExisting ?? 0),
        backgroundColor: "rgba(120,120,120,0.3)",
        borderColor: "rgba(120,120,120,1)",
        borderWidth: 1,
        xAxisID: "time-x",
        sortField: "time",
        hidden: true // Hidden by default
    });

    return {
        labels,
        datasets
    };
}

function renderChart(chartData) {
    const ctx = document.getElementById('rankingChart').getContext('2d');
    if (window.rankingChartInstance) {
        window.rankingChartInstance.destroy();
    }
    if (chartType === 'pie') {
        // Find the dataset matching the current sort, fallback to first
        const dataset = chartData.datasets.find(ds => ds.sortField === currentSort) || chartData.datasets[0];
        dataset.hidden = false; // Ensure the selected dataset is visible
        window.rankingChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: chartData.labels,
                datasets: [dataset]
            },
            options: {
                responsive: true
            }
        });
    } else {
        // Dynamically build scales based on present datasets
        const presentAxes = chartData.datasets.map(ds => ds.xAxisID).filter(Boolean);
        const allScales = {
            y: {
                beginAtZero: true,
                title: { display: false }
            }
            // "downloads-x": {
            //     type: "linear",
            //     position: "top",
            //     beginAtZero: true,
            //     title: { display: true, text: "Downloads" }
            // },
            // "rate-x": {
            //     type: "linear",
            //     position: "bottom",
            //     beginAtZero: true,
            //     grid: { drawOnChartArea: false },
            //     title: { display: true, text: "Download Rate" }
            // },
            // "mods-x": {
            //     type: "linear",
            //     position: "bottom",
            //     beginAtZero: true,
            //     grid: { drawOnChartArea: false },
            //     title: { display: true, text: "Mods" }
            // },
            // "time-x": {
            //     type: "linear",
            //     position: "bottom",
            //     beginAtZero: true,
            //     grid: { drawOnChartArea: false },
            //     title: { display: true, text: "Time (days)" }
            // }
        };
        // Only include scales for present axes
        const scales = { y: allScales.y };
        presentAxes.forEach(axis => {
            if (allScales[axis]) scales[axis] = allScales[axis];
        });

        window.rankingChartInstance = new Chart(ctx, {
            type: 'bar',
            data: chartData,
            options: {
                indexAxis: 'y',
                responsive: true,
                scales
            }
        });
    }
}

async function updateChart() {
    const rawData = await fetchChartData(currentEndpoint);
    // Show timestamp
    const ts = rawData?.generatedAt;
    if (ts) {
        document.getElementById('data-timestamp').textContent = `Data generated: ${new Date(ts).toLocaleString()}`;
    } else {
        document.getElementById('data-timestamp').textContent = '';
    }
    const chartData = transformInfoToChartData(rawData, currentSort, currentMax, currentSortDir);
    const chartCanvas = document.getElementById('rankingChart');
    // Only set height for bar chart
    if (chartType === 'bar') {
        chartCanvas.parentElement.style.height = Math.max(currentMax * 30, 20 * 30) + "px";
    } else {
        chartCanvas.parentElement.style.height = ""; // Reset for pie
    }
    chartCanvas.height = "100%";
    chartCanvas.width = "100%";

    if (chartData) {
        renderChart(chartData);
    } else {
        chartCanvas.parentElement.innerHTML +=
            "<div style='color:red'>Failed to load chart data.</div>";
    }
}


function setStatNavbarHandlers() {
    const modBtn = document.getElementById('mod_ranking_btn');
    const authorBtn = document.getElementById('author_ranking_btn');
    function setActive(isMod) {
        if (isMod) {
            modBtn.classList.add('active');
            authorBtn.classList.remove('active');
            currentEndpoint = '/api/mods.json';
        } else {
            authorBtn.classList.add('active');
            modBtn.classList.remove('active');
            currentEndpoint = '/api/authors.json';
        }
        updateSortBar();
        updateChart();
    }
    modBtn.onclick = () => setActive(true);
    authorBtn.onclick = () => setActive(false);
}

function setSortBarHandlers() {
    const sortBtns = document.querySelectorAll('.sort-btn');
    function updateSortUI() {
        sortBtns.forEach(btn => {
            const sort = btn.getAttribute('data-sort');
            btn.classList.toggle('active', sort === currentSort);
            const indicator = btn.querySelector('.sort-indicator');
            if (sort === currentSort) {
                indicator.textContent = currentSortDir === 'desc' ? '▼' : '▲';
            } else {
                indicator.textContent = '';
            }
        });
    }
    sortBtns.forEach(btn => {
        btn.onclick = function() {
            const sort = btn.getAttribute('data-sort');
            if (currentSort === sort) {
                currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
            } else {
                currentSort = sort;
                currentSortDir = 'desc';
            }
            updateSortUI();
            updateChart();
        };
    });
    updateSortUI();
    document.getElementById('maxEntries').oninput = async function(e) {
        // Fetch the current data to determine the max possible entries
        const rawData = await fetchChartData(currentEndpoint);
        const dataKey = rawData?.mods ? "mods" : (rawData?.authors ? "authors" : null);
        const totalEntries = rawData && dataKey && Array.isArray(rawData[dataKey]) ? rawData[dataKey].length : 1;

        // Clamp to available entries
        currentMax = Math.max(1, Math.min(totalEntries, parseInt(e.target.value) || 1));
        e.target.value = currentMax; // Update input to reflect clamp
        updateChart();
    };
    updateSortBar();
}

function updateSortBar() {
    const isAuthor = currentEndpoint.includes('author');
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const forType = btn.getAttribute('data-for');
        btn.style.display = (isAuthor && forType === 'authors') || (!isAuthor && forType === 'mods') ? '' : 'none';
    });
}

document.getElementById('toggle-pie').onclick = function() {
    chartType = chartType === 'bar' ? 'pie' : 'bar';
    this.textContent = chartType === 'bar' ? 'Pie Chart' : 'Bar Chart';
    updateChart();
};

function setSearchHandler() {
    const searchInput = document.getElementById('search-bar');
    if (!searchInput) return;
    searchInput.oninput = function(e) {
        currentSearch = e.target.value;
        updateChart();
    };
}

setStatNavbarHandlers();
setSortBarHandlers();
setSearchHandler();
updateChart();
