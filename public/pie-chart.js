import { COLORS } from './constants.js';

// Custom pie chart renderer
export class PieChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.container = this.canvas.parentElement;
        this.ctx = this.canvas.getContext('2d');
        
        this.data = null;
        this.hoveredIndex = -1;
        this.hoveredSegment = null;
        this.alphaHover = 'cc';
        this.alphaNormal = '99';
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        const rect = this.container.getBoundingClientRect();
        
        const dpr = window.devicePixelRatio || 1;
        // Use setTransform to avoid accumulating scales when this is called multiple
        // times (for example on window resize). setTransform replaces the current
        // transform whereas scale multiplies it which caused tooltip and hit-test
        // inconsistencies after repeated resizes or re-initialisations.
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        // Reset and apply the DPR transform so drawing uses CSS pixels in code below
        // (i.e. our logical width/height remain rect.width/rect.height)
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        this.width = rect.width;
        this.height = rect.height;
    }
    
    setupEventListeners() {
        // Use bound handlers so they can be removed on dispose
        this._onMouseMove = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handleMouseMove(x, y);
        };
        this._onMouseLeave = () => {
            this.hoveredIndex = -1;
            this.hoveredSegment = null;
            this.render();
        };
        this._onResize = () => {
            this.setupCanvas();
            this.render();
        };
        this._onWheel = (e) => {
            // Prevent default so the page doesn't scroll unexpectedly when the user
            // scrolls over the pie canvas.
            e.preventDefault();
        };

        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);
        window.addEventListener('resize', this._onResize);
    }

    // Clean up listeners when this chart is no longer used so old handlers do not
    // redraw the canvas after the chart type was switched.
    dispose() {
        if (this._onMouseMove) this.canvas.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseLeave) this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
        if (this._onWheel) this.canvas.removeEventListener('wheel', this._onWheel);
        if (this._onResize) window.removeEventListener('resize', this._onResize);
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
            
            const items = this.data.items;
            const values = items.map(item => this.getValueForSort(item));
            const total = values.reduce((a, b) => a + b, 0);
            
            // Walk slices and test membership with angle wrapping handled.
            let currentAngle = -Math.PI / 2;
            const TWO_PI = Math.PI * 2;
            const normalize = (a) => (a < 0 ? a + TWO_PI : a);

            for (let i = 0; i < items.length; i++) {
                const sliceAngle = (values[i] / total) * TWO_PI;
                const start = currentAngle;
                const end = currentAngle + sliceAngle;

                // Normalize to [0, 2PI) then handle wrapping ranges
                let s = normalize(start);
                let e = normalize(end);
                if (e < s) e += TWO_PI;

                let a = angle;
                if (a < s) a += TWO_PI;

                if (a >= s && a < e) {
                    this.hoveredIndex = i;
                    this.hoveredSegment = { x, y };
                    this.render();
                    return;
                }

                currentAngle = end;
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
        
        const items = this.data.items;
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