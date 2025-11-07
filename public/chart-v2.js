// Custom scrollable chart implementation for handling 800+ entries efficiently
// Uses virtual scrolling to only render visible bars

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

// Color palette matching the site design
const COLORS = {
    primary: '#2167a0',
    primaryLight: '#4a8bc2',
    secondary: '#f58c1c',
    secondaryLight: '#ff9d3d',
    tertiary: '#6464ff',
    tertiaryLight: '#8c8cff',
    background: '#ffffff',
    text: '#222222',
    textDim: '#666666',
    border: '#e6e6e6',
    hover: '#f0f0f0'
};

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

// Custom pie chart renderer
class PieChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.container = this.canvas.parentElement;
        this.ctx = this.canvas.getContext('2d');
        
        this.data = null;
        this.hoveredIndex = -1;
        this.hoveredSegment = null;
        this.maxPieItems = 20;
        this.alphaHover = 'cc';
        this.alphaNormal = '99';
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        const rect = this.container.getBoundingClientRect();
        
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.scale(dpr, dpr);
        
        this.width = rect.width;
        this.height = rect.height;
    }
    
    setupEventListeners() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handleMouseMove(x, y);
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredIndex = -1;
            this.hoveredSegment = null;
            this.render();
        });
        
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.render();
        });
    }
    
    setData(data) {
        this.data = data;
        this.hoveredIndex = -1;
        this.hoveredSegment = null;
        this.render();
    }
    
    handleMouseMove(x, y) {
        if (!this.data || !this.data.items) return;
        
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const radius = Math.min(this.width, this.height) * 0.35;
        
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= radius) {
            let angle = Math.atan2(dy, dx);
            if (angle < 0) angle += 2 * Math.PI;
            
            const items = this.data.items.slice(0, this.maxPieItems);
            const values = items.map(item => this.getValueForSort(item));
            const total = values.reduce((a, b) => a + b, 0);
            
            let currentAngle = -Math.PI / 2;
            for (let i = 0; i < items.length; i++) {
                const sliceAngle = (values[i] / total) * 2 * Math.PI;
                const endAngle = currentAngle + sliceAngle;
                
                if (angle >= currentAngle && angle < endAngle) {
                    this.hoveredIndex = i;
                    this.hoveredSegment = { x, y };
                    this.render();
                    return;
                }
                
                currentAngle = endAngle;
            }
        }
        
        this.hoveredIndex = -1;
        this.hoveredSegment = null;
        this.render();
    }
    
    getValueForSort(item) {
        const key = this.data.sortKey;
        return item[key] ?? 0;
    }
    
    getColorForIndex(index) {
        const colors = [
            COLORS.primary,
            COLORS.secondary,
            COLORS.tertiary,
            COLORS.primaryLight,
            COLORS.secondaryLight,
            COLORS.tertiaryLight
        ];
        return colors[index % colors.length];
    }
    
    render() {
        if (!this.data || !this.data.items) return;
        
        const ctx = this.ctx;
        
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, this.width, this.height);
        
        const items = this.data.items.slice(0, this.maxPieItems);
        const values = items.map(item => this.getValueForSort(item));
        const total = values.reduce((a, b) => a + b, 0);
        
        if (total === 0) return;
        
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        const radius = Math.min(this.width, this.height) * 0.35;
        
        let currentAngle = -Math.PI / 2;
        
        for (let i = 0; i < items.length; i++) {
            const sliceAngle = (values[i] / total) * 2 * Math.PI;
            const isHovered = i === this.hoveredIndex;
            
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
            ctx.closePath();
            
            const color = this.getColorForIndex(i);
            ctx.fillStyle = isHovered ? color + this.alphaHover : color + this.alphaNormal;
            ctx.fill();
            
            ctx.strokeStyle = COLORS.background;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            currentAngle += sliceAngle;
        }
        
        if (this.hoveredIndex >= 0 && this.hoveredSegment) {
            this.drawTooltip(items[this.hoveredIndex], this.hoveredSegment.x, this.hoveredSegment.y);
        }
    }
    
    drawTooltip(item, x, y) {
        const ctx = this.ctx;
        const padding = 10;
        const lineHeight = 18;
        
        const lines = [
            `${item.name}`,
            `Rank: #${item._staticRank}`,
            `Downloads: ${item.downloadCount?.toLocaleString() || 0}`,
            `Download Rate: ${(item.downloadRate || 0).toFixed(2)}/day`,
            `Days Existing: ${Math.floor(item.daysExisting || 0)}`
        ];
        
        if (item.author && !this.data.isAuthor) {
            lines.splice(1, 0, `Author: ${item.author}`);
        }
        
        if (this.data.isAuthor && item.mods) {
            lines.push(`Mods: ${item.mods}`);
        }
        
        ctx.font = '12px monospace';
        const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        const tooltipWidth = maxLineWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;
        
        let tooltipX = x + 15;
        let tooltipY = y - tooltipHeight / 2;
        
        if (tooltipX + tooltipWidth > this.width) {
            tooltipX = x - tooltipWidth - 15;
        }
        if (tooltipY < 0) tooltipY = 0;
        if (tooltipY + tooltipHeight > this.height) {
            tooltipY = this.height - tooltipHeight;
        }
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        ctx.fillStyle = COLORS.text;
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        lines.forEach((line, i) => {
            ctx.fillText(line, tooltipX + padding, tooltipY + padding + i * lineHeight);
        });
    }
}

// Custom scrollable chart renderer
class ScrollableChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.container = this.canvas.parentElement;
        this.ctx = this.canvas.getContext('2d');
        
        this.data = null;
        this.scrollOffset = 0;
        this.barHeight = 40;
        this.barSpacing = 5;
        this.leftPadding = 50;
        this.rightPadding = 70;
        this.topPadding = 10;
        this.bottomPadding = 10;
        this.hoveredIndex = -1;
        this.hoveredBar = null;
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Set canvas size to match container
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        
        // Handle high DPI displays
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.scale(dpr, dpr);
        
        this.width = rect.width;
        this.height = rect.height;
    }
    
    setupEventListeners() {
        // Mouse wheel scrolling
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.scrollOffset += e.deltaY * 0.5;
            this.clampScroll();
            this.render();
        }, { passive: false });
        
        // Mouse move for hover effects
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handleMouseMove(x, y);
        });
        
        // Mouse leave
        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredIndex = -1;
            this.hoveredBar = null;
            this.render();
        });
        
        // Resize handling
        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.render();
        });
    }
    
    setData(data) {
        this.data = data;
        this.scrollOffset = 0;
        this.hoveredIndex = -1;
        this.hoveredBar = null;
        this.render();
    }
    
    clampScroll() {
        if (!this.data || !this.data.items) return;
        
        const totalHeight = this.data.items.length * (this.barHeight + this.barSpacing);
        const maxScroll = Math.max(0, totalHeight - this.height + this.topPadding + this.bottomPadding);
        this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
    }
    
    handleMouseMove(x, y) {
        if (!this.data || !this.data.items) return;
        
        const visibleHeight = this.height - this.topPadding - this.bottomPadding;
        const startIndex = Math.floor(this.scrollOffset / (this.barHeight + this.barSpacing));
        const endIndex = Math.ceil((this.scrollOffset + visibleHeight) / (this.barHeight + this.barSpacing));
        
        let foundHover = false;
        for (let i = startIndex; i < Math.min(endIndex, this.data.items.length); i++) {
            const barY = this.topPadding + i * (this.barHeight + this.barSpacing) - this.scrollOffset;
            
            if (y >= barY && y <= barY + this.barHeight) {
                this.hoveredIndex = i;
                this.hoveredBar = { x, y };
                foundHover = true;
                break;
            }
        }
        
        if (!foundHover) {
            this.hoveredIndex = -1;
            this.hoveredBar = null;
        }
        
        this.render();
    }
    
    getValueForSort(item) {
        const key = this.data.sortKey;
        return item[key] ?? 0;
    }
    
    getColorForIndex(index) {
        // Alternate between color schemes for visual variety
        const colors = [
            { bar: COLORS.primary, light: COLORS.primaryLight },
            { bar: COLORS.secondary, light: COLORS.secondaryLight },
            { bar: COLORS.tertiary, light: COLORS.tertiaryLight }
        ];
        return colors[index % colors.length];
    }
    
    render() {
        if (!this.data || !this.data.items) return;
        
        const ctx = this.ctx;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.width, this.height);
        
        // Draw background
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, this.width, this.height);
        
        const items = this.data.items;
        const maxValue = Math.max(...items.map(item => this.getValueForSort(item)));
        const barWidth = this.width - this.leftPadding - this.rightPadding;
        
        // Calculate visible range
        const visibleHeight = this.height - this.topPadding - this.bottomPadding;
        const startIndex = Math.floor(this.scrollOffset / (this.barHeight + this.barSpacing));
        const endIndex = Math.ceil((this.scrollOffset + visibleHeight) / (this.barHeight + this.barSpacing));
        
        // Render only visible items
        for (let i = startIndex; i < Math.min(endIndex, items.length); i++) {
            const item = items[i];
            const value = this.getValueForSort(item);
            const barY = this.topPadding + i * (this.barHeight + this.barSpacing) - this.scrollOffset;
            
            // Skip if outside visible area
            if (barY + this.barHeight < 0 || barY > this.height) continue;
            
            const barValueWidth = (value / maxValue) * barWidth;
            const isHovered = i === this.hoveredIndex;
            const colors = this.getColorForIndex(i);
            
            // Draw bar background (lighter)
            ctx.fillStyle = COLORS.hover;
            ctx.fillRect(this.leftPadding, barY, barWidth, this.barHeight);
            
            // Draw bar value
            ctx.fillStyle = isHovered ? colors.light : colors.bar;
            ctx.fillRect(this.leftPadding, barY, barValueWidth, this.barHeight);
            
            // Draw border
            ctx.strokeStyle = COLORS.border;
            ctx.lineWidth = 1;
            ctx.strokeRect(this.leftPadding, barY, barWidth, this.barHeight);
            
            // Draw rank number on the left
            ctx.fillStyle = COLORS.textDim;
            ctx.font = '12px monospace';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`#${item._staticRank}`, this.leftPadding - 10, barY + this.barHeight / 2);
            
            // Draw name inside bar
            let displayName = item.name;
            if (item.author && !this.data.isAuthor) {
                displayName += ` (${item.author})`;
            }
            let textWidth = ctx.measureText(displayName).width;
            let isInside = barValueWidth > this.width - textWidth;

            ctx.fillStyle = isInside ? COLORS.background : COLORS.text;
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = isInside ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            
            const textX = isInside ? this.width - this.rightPadding - 10 : this.leftPadding + barValueWidth + 10;
            ctx.fillText(displayName, textX, barY + this.barHeight / 2);
            
            // Draw value on the right
            ctx.fillStyle = COLORS.textDim;
            ctx.font = '12px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(this.formatValue(value), this.width - 20, barY + this.barHeight / 2);
        }
        
        // Draw hover tooltip
        if (this.hoveredIndex >= 0 && this.hoveredBar) {
            this.drawTooltip(items[this.hoveredIndex], this.hoveredBar.x, this.hoveredBar.y);
        }
        
        // Draw scrollbar if needed
        const totalHeight = items.length * (this.barHeight + this.barSpacing);
        if (totalHeight > visibleHeight) {
            this.drawScrollbar(totalHeight, visibleHeight);
        }
    }
    
    truncateText(ctx, text, maxWidth) {
        if (maxWidth <= 0) return '';
        const width = ctx.measureText(text).width;
        if (width <= maxWidth) return text;
        
        // Binary search for the right length
        let left = 0;
        let right = text.length;
        while (left < right) {
            const mid = Math.floor((left + right + 1) / 2);
            const truncated = text.substring(0, mid) + '...';
            if (ctx.measureText(truncated).width <= maxWidth) {
                left = mid;
            } else {
                right = mid - 1;
            }
        }
        
        return left > 0 ? text.substring(0, left) + '...' : '';
    }
    
    formatValue(value) {
        if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
        if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
        return value.toFixed(0);
    }
    
    drawTooltip(item, x, y) {
        const ctx = this.ctx;
        const padding = 10;
        const lineHeight = 18;
        
        // Prepare tooltip lines
        const lines = [
            `${item.name}`,
            `Rank: #${item._staticRank}`,
            `Downloads: ${item.downloadCount?.toLocaleString() || 0}`,
            `Download Rate: ${(item.downloadRate || 0).toFixed(2)}/day`,
            `Days Existing: ${Math.floor(item.daysExisting || 0)}`
        ];
        
        if (item.author && !this.data.isAuthor) {
            lines.splice(1, 0, `Author: ${item.author}`);
        }
        
        if (this.data.isAuthor && item.mods) {
            lines.push(`Mods: ${item.mods}`);
        }
        
        // Calculate tooltip size
        ctx.font = '12px monospace';
        const maxLineWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
        const tooltipWidth = maxLineWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;
        
        // Position tooltip (avoid going off-screen)
        let tooltipX = x + 15;
        let tooltipY = y - tooltipHeight / 2;
        
        if (tooltipX + tooltipWidth > this.width) {
            tooltipX = x - tooltipWidth - 15;
        }
        if (tooltipY < 0) tooltipY = 0;
        if (tooltipY + tooltipHeight > this.height) {
            tooltipY = this.height - tooltipHeight;
        }
        
        // Draw tooltip background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        // Draw tooltip border
        ctx.strokeStyle = COLORS.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        
        // Draw tooltip text
        ctx.fillStyle = COLORS.text;
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        lines.forEach((line, i) => {
            ctx.fillText(line, tooltipX + padding, tooltipY + padding + i * lineHeight);
        });
    }
    
    drawScrollbar(totalHeight, visibleHeight) {
        const ctx = this.ctx;
        const scrollbarWidth = 8;
        const scrollbarX = this.width - scrollbarWidth - 5;
        
        const scrollbarHeight = (visibleHeight / totalHeight) * visibleHeight;
        const scrollbarY = (this.scrollOffset / totalHeight) * visibleHeight + this.topPadding;
        
        // Draw scrollbar background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(scrollbarX, this.topPadding, scrollbarWidth, visibleHeight);
        
        // Draw scrollbar thumb
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(scrollbarX, scrollbarY, scrollbarWidth, scrollbarHeight);
    }
}

let chartInstance = null;

function renderChart(chartData) {
    const container = document.getElementById('rankingChart').parentElement;
    
    if (chartType === 'bar') {
        // Use custom scrollable chart
        if (!chartInstance || !(chartInstance instanceof ScrollableChart)) {
            chartInstance = new ScrollableChart('rankingChart');
        }
        chartInstance.setData(chartData);
    } else {
        // Use custom pie chart
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
    
    const chartData = transformInfoToChartData(rawData, currentSort, currentMax, currentSortDir);
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
    
    maxEntriesInput.addEventListener('blur', async function(e) {
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
    });
    
    maxEntriesInput.addEventListener('change', async function(e) {
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
    });
    
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
