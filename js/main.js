// ===== FAQ: Mostrar/Ocultar respuestas =====
document.addEventListener('DOMContentLoaded', function() {
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const question = item.querySelector('h4');
        const answer = item.querySelector('p');
        const toggle = item.querySelector('.toggle');
        
        // Por defecto, mostrar el primero abierto
        if (item === faqItems[0]) {
            item.classList.add('active');
            if (answer) answer.style.display = 'block';
            if (toggle) toggle.textContent = '×';
        }
        
        question.addEventListener('click', function() {
            const isActive = item.classList.contains('active');
            
            // Cerrar todos los demás
            faqItems.forEach(other => {
                other.classList.remove('active');
                const otherAnswer = other.querySelector('p');
                const otherToggle = other.querySelector('.toggle');
                if (otherAnswer) otherAnswer.style.display = 'none';
                if (otherToggle) otherToggle.textContent = '+';
            });
            
            // Abrir el actual si estaba cerrado
            if (!isActive) {
                item.classList.add('active');
                if (answer) answer.style.display = 'block';
                if (toggle) toggle.textContent = '×';
            }
        });
    });
});

// ===== Smooth Scroll para enlaces internos =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        
        const target = document.querySelector(targetId);
        if (target) {
            e.preventDefault();
            const headerOffset = 80;
            const elementPosition = target.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
            
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// ===== Header shadow on scroll =====
const header = document.querySelector('.header');
let lastScrollY = 0;

window.addEventListener('scroll', function() {
    const currentScrollY = window.scrollY;
    
    if (currentScrollY > 10) {
        header.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)';
    } else {
        header.style.boxShadow = 'none';
    }
    
    lastScrollY = currentScrollY;
});

console.log('🚀 TalenCrew cargado correctamente');
