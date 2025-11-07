// Custom scrollable chart implementation for handling 800+ entries efficiently
// Uses virtual scrolling to only render visible bars

import { PieChart } from './pie-chart.js';
import { ScrollableChart } from './bar-chart.js';

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
let currentMax = 100;
let chartType = 'bar';
let currentSearch = "";
let currentDisplayedEntriesCount = 1;

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

    return {
        items: items,
        sortKey: mappedSortKey,
        isAuthor: !!rawData.authors
    };
}



let chartInstance = null;

function renderChart(chartData) {
    const container = document.getElementById('rankingChart').parentElement;
    
    if (chartType === 'bar') {
        // Switch to bar chart; if an existing different chart instance exists, dispose it
        if (chartInstance && !(chartInstance instanceof ScrollableChart) && typeof chartInstance.dispose === 'function') {
            chartInstance.dispose();
            chartInstance = null;
        }
        if (!chartInstance || !(chartInstance instanceof ScrollableChart)) {
            chartInstance = new ScrollableChart('rankingChart');
        }
        chartInstance.setData(chartData);
    } else {
        // Switch to pie chart; dispose previous if it was a different type
        if (chartInstance && !(chartInstance instanceof PieChart) && typeof chartInstance.dispose === 'function') {
            chartInstance.dispose();
            chartInstance = null;
        }
        if (!chartInstance || !(chartInstance instanceof PieChart)) {
            chartInstance = new PieChart('rankingChart');
        }
        chartInstance.setData(chartData);
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
    
    // Allow the pie chart to display the requested number of entries.
    // Previously this capped pies to 20 entries which prevented users from
    // seeing larger requested counts from the input control.
    const maxEntries = currentMax;
    const chartData = transformInfoToChartData(rawData, currentSort, maxEntries, currentSortDir);
    const chartContainer = document.getElementById('rankingChart').parentElement;
    
    currentDisplayedEntriesCount = chartData.items.length;
    
    // Ensure canvas element exists
    let canvas = document.getElementById('rankingChart');
    if (!canvas) {
        chartContainer.innerHTML = '<canvas id="rankingChart"></canvas>';
    }
    
    // Set container height for bar chart
    if (chartType === 'bar') {
        chartContainer.style.height = '600px';
    } else {
        chartContainer.style.height = '600px';
    }

    if (chartData) {
        renderChart(chartData);
    } else {
        chartContainer.innerHTML += "<div style='color:red'>Failed to load chart data.</div>";
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
    
    // Only allow numeric input and validate on blur
    const maxEntriesInput = document.getElementById('maxEntries');
    
    maxEntriesInput.addEventListener('keypress', function(e) {
        // Only allow numbers
        if (e.key && !/[0-9]/.test(e.key)) {
            e.preventDefault();
        }
    });
    
    // Shared validation function
    async function validateAndUpdateMaxEntries(e) {
        // Fetch the current data to determine the max possible entries
        const rawData = await fetchChartData(currentEndpoint);

        // Determine if we're on mods or authors
        const dataKey = rawData?.mods ? "mods" : (rawData?.authors ? "authors" : null);
        const totalEntries = rawData && dataKey && Array.isArray(rawData[dataKey]) ? rawData[dataKey].length : 1;

        // Clamp to available entries
        const value = parseInt(e.target.value) || 1;
        currentMax = Math.max(1, Math.min(totalEntries, value));
        e.target.value = currentMax; // Update input to reflect clamp
        updateChart();
    }
    
    maxEntriesInput.addEventListener('blur', validateAndUpdateMaxEntries);
    maxEntriesInput.addEventListener('change', validateAndUpdateMaxEntries);
    
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
