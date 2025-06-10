
let isDragging = false;
let startX, startY;
let scale = 0.5;
let currentX = 0, currentY = 0;

function zoomImage(img) {
    var modal = document.getElementById("imageModal");
    var modalImg = document.getElementById("modalImg");

    
    isDragging = false;
    scale = 0.5;
    currentX = 0;
    currentY = 0;

    modal.style.display = "block";
    modalImg.src = img.src;

    modalImg.style.width = "auto";
    modalImg.style.height = "auto";
    modalImg.style.maxWidth = "none";
    modalImg.style.maxHeight = "none";
    
    modalImg.style.cursor = "grab";
    modalImg.style.position = "absolute";
    modalImg.style.left = "50%";
    modalImg.style.top = "50%";
    modalImg.style.transform = `translate(-50%, -50%) scale(${scale})`;

    
    modalImg.removeEventListener("mousedown", handleMouseDown);
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousemove", handleMouseMove);
    modalImg.removeEventListener("wheel", handleWheel);

    
    modalImg.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);
    modalImg.addEventListener("wheel", handleWheel);

    function handleMouseDown(e) {
        isDragging = true;
        startX = e.clientX - currentX;
        startY = e.clientY - currentY;
        modalImg.style.cursor = "grabbing";
        e.preventDefault();
    }

    function handleMouseUp() {
        if (isDragging) {
            isDragging = false;
            modalImg.style.cursor = "grab";
        }
    }

    function handleMouseMove(e) {
        if (!isDragging) return;
    
        let newX = e.clientX - startX;
        let newY = e.clientY - startY;
        
        const imgWidth = modalImg.naturalWidth * scale;
        const imgHeight = modalImg.naturalHeight * scale;
        
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        
        const maxX = Math.max(0, (imgWidth - viewportWidth) / 2);
        const maxY = Math.max(0, (imgHeight - viewportHeight) / 2);
        
        
        currentX = Math.max(-maxX, Math.min(maxX, newX));
        currentY = Math.max(-maxY, Math.min(maxY, newY));
        
        modalImg.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(${scale})`;
    }

    function handleWheel(e) {
        e.preventDefault();
        let rect = modalImg.getBoundingClientRect();
        let mouseX = e.clientX - rect.left;
        let mouseY = e.clientY - rect.top;

        let prevScale = scale;
        scale += e.deltaY > 0 ? -0.025 : 0.025;
        scale = Math.max(0.1, Math.min(3, scale));
        
        let deltaScale = scale / prevScale;
        currentX = mouseX - (mouseX - currentX) * deltaScale;
        currentY = mouseY - (mouseY - currentY) * deltaScale;
        
        
        const imgWidth = modalImg.naturalWidth * scale;
        const imgHeight = modalImg.naturalHeight * scale;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxX = Math.max(0, (imgWidth - viewportWidth) / 2);
        const maxY = Math.max(0, (imgHeight - viewportHeight) / 2);
        
        currentX = Math.max(-maxX, Math.min(maxX, currentX));
        currentY = Math.max(-maxY, Math.min(maxY, currentY));

        modalImg.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(${scale})`;
    }
}

function closeModal() {
    document.getElementById("imageModal").style.display = "none";
}