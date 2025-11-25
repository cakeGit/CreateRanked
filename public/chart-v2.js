// Custom scrollable chart implementation for handling 800+ entries efficiently
// Uses virtual scrolling to only render visible bars

import { PieChart } from './pie-chart.js';
import { ScrollableChart } from './bar-chart.js';
import { BubbleChart } from './bubble-chart.js';

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
let currentRowCount = 20;

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
    const searchLower = (currentSearch || '').trim().toLowerCase();
    if (searchLower && chartType !== 'bubble') {
        // For bar/pie: filter list
        items = items.filter(item =>
            (item.name && item.name.toLowerCase().includes(searchLower)) ||
            (item.author && item.author.toLowerCase().includes(searchLower))
        );
    }

    items = items.slice(0, maxEntries);

    return {
        items: items,
        sortKey: mappedSortKey,
        isAuthor: !!rawData.authors,
        searchTerm: searchLower
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
        chartInstance.setData(chartData, currentRowCount);
    } else if (chartType === 'bubble') {
        if (chartInstance && !(chartInstance instanceof BubbleChart) && typeof chartInstance.dispose === 'function') {
            chartInstance.dispose();
            chartInstance = null;
        }
        if (!chartInstance || !(chartInstance instanceof BubbleChart)) {
            chartInstance = new BubbleChart('rankingChart');
        }
        // Allow the bubble chart to slice to the requested top N
        if (chartInstance && typeof chartInstance.topNExplicit !== 'undefined') {
            chartInstance.topNExplicit = currentMax;
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
    let maxEntries = currentMax;
    if (chartType === 'bubble') {
        maxEntries = 10000; // Fetch all for bubble chart
    }
    const chartData = transformInfoToChartData(rawData, currentSort, maxEntries, currentSortDir);
    const chartContainer = document.getElementById('rankingChart').parentElement;
    
    currentDisplayedEntriesCount = chartData.items.length;
    
    // Ensure canvas element exists
    let canvas = document.getElementById('rankingChart');
    if (!canvas) {
        chartContainer.innerHTML = '<canvas id="rankingChart"></canvas>';
    }
    
    // Toggle row count visibility based on chart type
    const rowCountLabel = document.getElementById('rowCountLabel');
    const rowCountInput = document.getElementById('rowCount');
    const togglePieBtn = document.getElementById('toggle-pie');
    const toggleLabelsBtn = document.getElementById('toggle-labels');
    const toggleGroupLabelsBtn = document.getElementById('toggle-group-labels');
    const toggleFullGroupsBtn = document.getElementById('toggle-full-groups');
    const bubbleControls = document.getElementById('bubble-controls');

    if (chartType === 'bar') {
        rowCountLabel.style.display = '';
        rowCountInput.style.display = '';
        togglePieBtn.style.display = '';
        toggleLabelsBtn.style.display = 'none';
        if (toggleFullGroupsBtn) toggleFullGroupsBtn.style.display = 'none';
        if (bubbleControls) bubbleControls.style.display = 'none';
    } else if (chartType === 'pie') {
        rowCountLabel.style.display = 'none';
        rowCountInput.style.display = 'none';
        togglePieBtn.style.display = '';
        toggleLabelsBtn.style.display = 'none';
        if (toggleFullGroupsBtn) toggleFullGroupsBtn.style.display = 'none';
        if (bubbleControls) bubbleControls.style.display = 'none';
    } else if (chartType === 'bubble') {
        rowCountLabel.style.display = 'none';
        rowCountInput.style.display = 'none';
        togglePieBtn.style.display = 'none';
        toggleLabelsBtn.style.display = '';
        if (toggleGroupLabelsBtn) toggleGroupLabelsBtn.style.display = '';
        if (toggleFullGroupsBtn) toggleFullGroupsBtn.style.display = '';
        if (bubbleControls) bubbleControls.style.display = 'flex';
        // Sync button text with chart's current label state
        if (chartInstance && chartInstance instanceof BubbleChart) {
            toggleLabelsBtn.textContent = chartInstance.showLabels ? 'Hide Labels' : 'Show Labels';
            if (toggleGroupLabelsBtn) toggleGroupLabelsBtn.textContent = chartInstance.showGroupLabels ? 'Hide Group Label' : 'Show Group Label';
            if (toggleFullGroupsBtn) {
                toggleFullGroupsBtn.textContent = chartInstance.includeFullGroups ? 'Show Top Only' : 'Include Full Groups';
            }
        }
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
    const distBtn = document.getElementById('mod_distribution_btn');

    function setActive(mode) {
        modBtn.classList.remove('active');
        authorBtn.classList.remove('active');
        distBtn.classList.remove('active');

        if (mode === 'mod') {
            modBtn.classList.add('active');
            currentEndpoint = '/api/mods.json';
            if (chartType === 'bubble') chartType = 'bar';
        } else if (mode === 'author') {
            authorBtn.classList.add('active');
            currentEndpoint = '/api/authors.json';
            if (chartType === 'bubble') chartType = 'bar';
        } else if (mode === 'dist') {
            distBtn.classList.add('active');
            currentEndpoint = '/api/mods.json';
            chartType = 'bubble';
        }
        updateSortBar();
        updateChart();
    }
    modBtn.onclick = () => setActive('mod');
    authorBtn.onclick = () => setActive('author');
    distBtn.onclick = () => setActive('dist');
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
    const isBubble = chartType === 'bubble';
    const sortLabel = document.getElementById('sortByLabel');
    if (sortLabel) sortLabel.style.display = isBubble ? 'none' : '';
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const forType = btn.getAttribute('data-for');
        if (isBubble) {
            btn.style.display = 'none';
        } else {
            btn.style.display = (isAuthor && forType === 'authors') || (!isAuthor && forType === 'mods') ? '' : 'none';
        }
    });
}

document.getElementById('toggle-pie').onclick = function() {
    chartType = chartType === 'bar' ? 'pie' : 'bar';
    this.textContent = chartType === 'bar' ? 'Pie Chart' : 'Bar Chart';
    updateChart();
};

document.getElementById('toggle-labels').onclick = function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        const newState = !chartInstance.showLabels;
        chartInstance.toggleLabels(newState);
        this.textContent = newState ? 'Hide Labels' : 'Show Labels';
    }
};

document.getElementById('toggle-group-labels').onclick = function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        const newState = !chartInstance.showGroupLabels;
        chartInstance.toggleGroupLabels(newState);
        this.textContent = newState ? 'Hide Group Label' : 'Show Group Label';
    }
};

document.getElementById('toggle-full-groups').onclick = function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        const newState = !chartInstance.includeFullGroups;
        chartInstance.setIncludeFullGroups(newState);
        this.textContent = newState ? 'Show Top Only' : 'Include Full Groups';
    }
};

// Bubble chart zoom controls
document.getElementById('zoom-in-btn')?.addEventListener('click', function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        chartInstance.zoomIn();
    }
});

document.getElementById('zoom-out-btn')?.addEventListener('click', function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        chartInstance.zoomOut();
    }
});

document.getElementById('reset-zoom-btn')?.addEventListener('click', function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        chartInstance.resetZoom();
    }
});

document.getElementById('fullscreen-btn')?.addEventListener('click', function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        chartInstance.toggleFullscreen();
    }
});

document.getElementById('download-btn')?.addEventListener('click', function() {
    if (chartInstance && chartInstance instanceof BubbleChart) {
        chartInstance.downloadHighRes();
    }
});

function setSearchHandler() {
    const searchInput = document.getElementById('search-bar');
    if (!searchInput) return;
    searchInput.oninput = function(e) {
        currentSearch = e.target.value;
        // For bubble chart, just update search term without recreating
        if (chartType === 'bubble' && chartInstance && chartInstance instanceof BubbleChart) {
            chartInstance.setSearchTerm(currentSearch);
        } else {
            updateChart();
        }
    };
}

function setRowCountHandler() {
    const rowCountInput = document.getElementById('rowCount');
    if (!rowCountInput) return;
    
    rowCountInput.addEventListener('keydown', function(e) {
        // Allow numbers, navigation keys, and control keys
        const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Home', 'End'];
        if (e.key && !/[0-9]/.test(e.key) && !allowedKeys.includes(e.key)) {
            e.preventDefault();
        }
    });
    
    function validateAndUpdateRowCount(e) {
        const value = parseInt(e.target.value) || 1;
        // Clamp between 1 and 100
        currentRowCount = Math.max(1, Math.min(100, value));
        e.target.value = currentRowCount;
        updateChart();
    }
    
    rowCountInput.addEventListener('blur', validateAndUpdateRowCount);
    rowCountInput.addEventListener('change', validateAndUpdateRowCount);
}

setStatNavbarHandlers();
setSortBarHandlers();
setSearchHandler();
setRowCountHandler();
updateChart();
