import { COLORS } from './constants.js';

// Custom scrollable chart renderer
export class ScrollableChart {
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
        this.rowCount = 20; // Default row count for visible bars
        
        this.setupCanvas();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Set canvas size to match container
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        // Set the canvas backing store size in device pixels and style in CSS pixels
        this.canvas.width = Math.round(rect.width * dpr);
        this.canvas.height = Math.round(rect.height * dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        // Replace current transform with DPR scaling. Using setTransform avoids
        // multiplying the transform repeatedly when this method is called on resize.
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        
        this.width = rect.width;
        this.height = rect.height;
    }
    
    setupEventListeners() {
        // Bound handlers so we can remove them on dispose
        this._onWheel = (e) => {
            e.preventDefault();
            this.scrollOffset += e.deltaY * 0.5;
            this.clampScroll();
            this.render();
        };

        this._onMouseMove = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.handleMouseMove(x, y);
        };

        this._onMouseLeave = () => {
            this.hoveredIndex = -1;
            this.hoveredBar = null;
            this.render();
        };

        this._onResize = () => {
            this.setupCanvas();
            this.calculateBarHeight();
            this.render();
        };

        // Touch handlers for mobile scrolling
        this._touchStartY = 0;
        this._onTouchStart = (e) => {
            if (e.touches.length === 1) {
                this._touchStartY = e.touches[0].clientY;
            }
        };

        this._onTouchMove = (e) => {
            if (e.touches.length === 1) {
                // Prevent default to stop page scrolling while scrolling the chart
                if (e.cancelable) e.preventDefault();
                
                const y = e.touches[0].clientY;
                const deltaY = this._touchStartY - y;
                this._touchStartY = y;
                
                this.scrollOffset += deltaY;
                this.clampScroll();
                this.render();
            }
        };

        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
        this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        window.addEventListener('resize', this._onResize);
    }

    // Remove listeners when chart is disposed so old handlers can't redraw
    // the canvas after switching chart types.
    dispose() {
        if (this._onWheel) this.canvas.removeEventListener('wheel', this._onWheel);
        if (this._onMouseMove) this.canvas.removeEventListener('mousemove', this._onMouseMove);
        if (this._onMouseLeave) this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
        if (this._onTouchStart) this.canvas.removeEventListener('touchstart', this._onTouchStart);
        if (this._onTouchMove) this.canvas.removeEventListener('touchmove', this._onTouchMove);
        if (this._onResize) window.removeEventListener('resize', this._onResize);
    }
    
    setData(data, rowCount = 20) {
        this.data = data;
        this.rowCount = rowCount;
        this.scrollOffset = 0;
        this.hoveredIndex = -1;
        this.hoveredBar = null;
        this.calculateBarHeight();
        this.render();
    }
    
    calculateBarHeight() {
        // Calculate bar height based on row count to fit in visible area
        const visibleHeight = this.height - this.topPadding - this.bottomPadding;
        // Total height needed = rowCount * barHeight + (rowCount - 1) * barSpacing
        // Solve for barHeight: visibleHeight = rowCount * barHeight + (rowCount - 1) * barSpacing
        // barHeight = (visibleHeight - (rowCount - 1) * barSpacing) / rowCount
        this.barHeight = Math.max(10, (visibleHeight - (this.rowCount - 1) * this.barSpacing) / this.rowCount);
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
            let isInside = barValueWidth + textWidth + 10 > barWidth;

            ctx.fillStyle = isInside ? COLORS.background : COLORS.text;
            ctx.font = 'bold 14px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            
            const textX = isInside ? barValueWidth - textWidth : barValueWidth + 10 + this.leftPadding;
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