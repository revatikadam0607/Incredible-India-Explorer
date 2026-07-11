/**
 * router.js
 * Vanilla JavaScript Single Page Application Routing Engine
 */

class LifecycleManager {
    constructor() {
        this.cleanups = [];
    }

    /**
     * Register a cleanup function to be called before the next route change.
     * @param {Function} cleanupFn 
     */
    registerCleanup(cleanupFn) {
        if (typeof cleanupFn === 'function') {
            this.cleanups.push(cleanupFn);
        }
    }

    /**
     * Execute all registered cleanups and clear the array.
     */
    runCleanups() {
        this.cleanups.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.error("Error during cleanup:", e);
            }
        });
        this.cleanups = [];
    }

    /**
     * Add an event listener to window/document and automatically register its cleanup.
     * @param {EventTarget} target (window or document)
     * @param {string} event 
     * @param {Function} handler 
     * @param {Object|boolean} options 
     */
    addEventListener(target, event, handler, options = false) {
        target.addEventListener(event, handler, options);
        this.registerCleanup(() => {
            target.removeEventListener(event, handler, options);
        });
    }
}

window.appLifecycle = new LifecycleManager();

class Router {
    constructor() {
        this.appRoot = document.getElementById('app-root');
        if (!this.appRoot) {
            // Find main and add id if it doesn't exist
            this.appRoot = document.querySelector('main');
            if (this.appRoot) {
                this.appRoot.id = 'app-root';
            }
        }

        this.loadedScripts = new Set();
        this.loadedStyles = new Set();

        // Track initially loaded scripts and styles
        document.querySelectorAll('script[src]').forEach(s => {
            // we do not want to prevent reloading of scripts if they are dynamic, but app.js and router.js shouldn't reload.
            // actually we only append if not present.
            this.loadedScripts.add(s.getAttribute('src'))
        });
        document.querySelectorAll('link[rel="stylesheet"]').forEach(l => this.loadedStyles.add(l.getAttribute('href')));

        this.init();
    }

    init() {
        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            this.handleRoute(window.location.pathname + window.location.search + window.location.hash, false);
        });

        // Intercept link clicks
        document.body.addEventListener('click', (e) => {
            const link = e.target.closest('a');

            // Check if it's a valid internal link
            if (link && link.href && link.target !== '_blank') {
                const url = new URL(link.href);
                const currentUrl = new URL(window.location.href);

                // Same origin, and not a mailto/tel link
                if (url.origin === currentUrl.origin) {

                    // If it's just a hash change on the SAME page, let default behavior happen
                    if (url.pathname === currentUrl.pathname && url.search === currentUrl.search) {
                        return; // Let browser scroll
                    }

                    // Otherwise, prevent default and navigate
                    e.preventDefault();

                    // Push state only if URL actually changes
                    if (url.href !== currentUrl.href) {
                        this.handleRoute(url.pathname + url.search + url.hash, true);
                    }
                }
            }
        });

        // Fire initial route event
        this.dispatchRouteEvent();

        // Initialize Global Search Trigger
        if (typeof initializeGlobalSearch === 'function') {
            initializeGlobalSearch();
        }
    }

    async handleRoute(path, push = true) {
        // Clean up previous route
        window.appLifecycle.runCleanups();

        // Trigger before-route event
        document.dispatchEvent(new CustomEvent('app:before-route', { detail: { path } }));

        if (this.appRoot) {
            this.appRoot.classList.add('page-transitioning');
        }

        try {
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const htmlString = await response.text();

            // Parse the fetched HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlString, 'text/html');

            // Update Title
            document.title = doc.title;

            // Extract main content
            const newMain = doc.querySelector('main');
            if (newMain && this.appRoot) {
                // Wait for fade out animation
                await new Promise(r => setTimeout(r, 300));

                this.appRoot.innerHTML = newMain.innerHTML;

                // Process new scripts and styles
                this.processHead(doc);
                this.processBodyScripts(doc);

                if (push) {
                    window.history.pushState(null, '', path);
                }

                this.appRoot.classList.remove('page-transitioning');

                // Handle hash scrolling if present
                const hash = new URL(path, window.location.origin).hash;
                if (hash) {
                    setTimeout(() => {
                        const target = document.querySelector(hash);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth' });
                        }
                    }, 100);
                } else {
                    window.scrollTo(0, 0);
                }
                // Dispatch route changed event
                this.dispatchRouteEvent();

                // Re-initialize Global Search Trigger on page transition
                if (typeof initializeGlobalSearch === 'function') {
                    initializeGlobalSearch();
                }
            } else {
                // Fallback if no main tag found
                window.location.href = path;
            }

        } catch (error) {
            console.error('Routing failed:', error);
            // Fallback to normal navigation
            window.location.href = path;
        }
    }

    processHead(doc) {
        const promises = [];
        // Extract and inject new stylesheets
        doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.getAttribute('href');
            if (href && !this.loadedStyles.has(href)) {
                const newLink = document.createElement('link');
                newLink.rel = 'stylesheet';
                newLink.href = href;
                
                const p = new Promise(resolve => {
                    newLink.onload = () => resolve();
                    newLink.onerror = () => resolve();
                });
                promises.push(p);

                document.head.appendChild(newLink);
                this.loadedStyles.add(href);
            }
        });
        return Promise.all(promises);
    }

    processBodyScripts(doc) {
        // Collect all scripts from the fetched page
        const scripts = [...doc.querySelectorAll('script')];

        scripts.forEach(oldScript => {
            const src = oldScript.getAttribute('src');

            if (src) {
                // External script
                if (!this.loadedScripts.has(src)) {
                    const newScript = document.createElement('script');
                    newScript.src = src;
                    Array.from(oldScript.attributes).forEach(attr => {
                        if (attr.name !== 'src') {
                            newScript.setAttribute(attr.name, attr.value);
                        }
                    });
                    document.body.appendChild(newScript);
                    this.loadedScripts.add(src);
                }
            } else {
                // Inline script
                const newScript = document.createElement('script');
                newScript.textContent = oldScript.textContent;
                document.body.appendChild(newScript);
            }
        });
    }

    dispatchRouteEvent() {
        // Dispatch custom event for scripts to re-initialize
        const event = new CustomEvent('app:route-changed', {
            detail: { url: window.location.pathname }
        });
        document.dispatchEvent(event);
    }
}

// Initialize Router when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.appRouter = new Router();
    if (typeof initializeGlobalSearch === 'function') {
        initializeGlobalSearch();
    }
});

/* ==========================================================================
   GLOBAL SEARCH IMPLEMENTATION
   ========================================================================== */

function getPathPrefix() {
    const path = window.location.pathname;
    if (path.includes('/states/') ||
        path.includes('/traditional-games/') ||
        path.includes('/freedom-timeline/') ||
        path.includes('/postal-stamps/') ||
        path.includes('/handloom/')) {
        return '../';
    }
    return '';
}

function loadSearchScript(callback) {
    if (window.indiaSearchIndex) {
        if (callback) callback();
        return;
    }
    const script = document.createElement('script');
    script.src = getPathPrefix() + 'search-index.js';
    script.onload = () => {
        if (callback) callback();
    };
    script.onerror = () => {
        console.error("Failed to load search index.");
    };
    document.body.appendChild(script);
}

function initializeGlobalSearch() {
    const themeToggle = document.getElementById('theme-toggle');
    const navMenu = document.getElementById('nav-menu') || document.querySelector('.nav-menu');
    const navContainer = document.querySelector('.nav-container');

    if (!document.getElementById('global-search-trigger')) {
        const searchTrigger = document.createElement('button');
        searchTrigger.id = 'global-search-trigger';
        searchTrigger.className = 'btn-search-trigger';
        searchTrigger.setAttribute('aria-label', 'Search entire website');
        searchTrigger.setAttribute('title', 'Search Website');
        searchTrigger.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
        `;

        if (themeToggle) {
            themeToggle.parentNode.insertBefore(searchTrigger, themeToggle);
        } else if (navMenu) {
            navMenu.appendChild(searchTrigger);
        } else if (navContainer) {
            navContainer.appendChild(searchTrigger);
        }

        // Bind open click event
        searchTrigger.addEventListener('click', openSearchModal);
    }
}

let currentFocusIndex = -1;
let previousActiveElement = null;

function createSearchModal() {
    let modal = document.getElementById('global-search-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'global-search-modal';
    modal.className = 'search-modal';
    modal.style.display = 'none';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Website Search');

    modal.innerHTML = `
        <div class="search-modal-backdrop"></div>
        <div class="search-modal-container">
            <div class="search-modal-header">
                <div class="search-input-wrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input type="text" id="global-search-input" placeholder="Search states, cuisines, monuments, wildlife..." aria-label="Search website content" autocomplete="off" />
                    <button id="global-search-clear" class="btn-search-clear" aria-label="Clear search" style="display: none;">✕</button>
                </div>
                <button id="global-search-close" class="btn-search-close" aria-label="Close search">✕</button>
            </div>
            <div class="search-modal-body">
                <div id="search-results-container" class="search-results-container">
                    <div class="search-initial-state">
                        <p class="search-hint-title">Search Across Incredible India</p>
                        <p class="search-hint-desc">Discover heritage, cities, wildlife, sports, and culture instantly.</p>
                        <div class="search-shortcuts">
                            <span class="search-shortcut-tag" data-query="Taj Mahal">Taj Mahal</span>
                            <span class="search-shortcut-tag" data-query="Biryani">Biryani</span>
                            <span class="search-shortcut-tag" data-query="Hornbill">Hornbill</span>
                            <span class="search-shortcut-tag" data-query="Kerala">Kerala</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="search-modal-footer">
                <span class="search-key-hint"><kbd>↑↓</kbd> Navigate</span>
                <span class="search-key-hint"><kbd>Enter</kbd> Select</span>
                <span class="search-key-hint"><kbd>Esc</kbd> Close</span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setupModalEvents(modal);
    return modal;
}

function openSearchModal() {
    document.body.classList.add('no-scroll');
    document.documentElement.classList.add('no-scroll');

    previousActiveElement = document.activeElement;

    const modal = createSearchModal();
    modal.style.display = 'flex';

    loadSearchScript(() => {
        const input = document.getElementById('global-search-input');
        if (input) {
            performSearch(input.value);
            input.focus();
        }
    });

    document.addEventListener('keydown', handleEscKey);
}

function closeSearchModal() {
    const modal = document.getElementById('global-search-modal');
    if (!modal) return;

    modal.style.display = 'none';

    document.body.classList.remove('no-scroll');
    document.documentElement.classList.remove('no-scroll');

    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
    }

    document.removeEventListener('keydown', handleEscKey);
}

function handleEscKey(e) {
    if (e.key === 'Escape') {
        closeSearchModal();
    }
}

function setupModalEvents(modal) {
    const backdrop = modal.querySelector('.search-modal-backdrop');
    const closeBtn = modal.querySelector('#global-search-close');
    const clearBtn = modal.querySelector('#global-search-clear');
    const input = modal.querySelector('#global-search-input');

    backdrop.addEventListener('click', closeSearchModal);
    closeBtn.addEventListener('click', closeSearchModal);

    clearBtn.addEventListener('click', () => {
        input.value = '';
        performSearch('');
        input.focus();
    });

    input.addEventListener('input', (e) => {
        currentFocusIndex = -1;
        performSearch(e.target.value);
    });

    // Keyboard navigation and accessibility
    modal.addEventListener('keydown', (e) => {
        const list = modal.querySelector('.search-results-list');

        if (e.key === 'Tab') {
            const focusableElements = Array.from(modal.querySelectorAll('input, button, [tabindex="0"], .search-result-item'));
            if (focusableElements.length === 0) return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey) { // Shift + Tab
                if (document.activeElement === firstElement) {
                    lastElement.focus();
                    e.preventDefault();
                }
            } else { // Tab
                if (document.activeElement === lastElement) {
                    firstElement.focus();
                    e.preventDefault();
                }
            }
            return;
        }

        if (!list) return;
        const items = list.querySelectorAll('.search-result-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            currentFocusIndex++;
            if (currentFocusIndex >= items.length) {
                currentFocusIndex = 0;
            }
            updateFocus(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            currentFocusIndex--;
            if (currentFocusIndex < 0) {
                currentFocusIndex = items.length - 1;
            }
            updateFocus(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (currentFocusIndex >= 0 && currentFocusIndex < items.length) {
                items[currentFocusIndex].click();
            } else if (items.length > 0) {
                items[0].click();
            }
        }
    });
}

function updateFocus(items) {
    items.forEach((item, index) => {
        if (index === currentFocusIndex) {
            item.classList.add('active');
            item.setAttribute('aria-selected', 'true');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
            item.removeAttribute('aria-selected');
        }
    });
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, query) {
    if (!query) return text;
    const escapedQuery = escapeRegExp(query);
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return text.replace(regex, '<span class="search-result-highlight">$1</span>');
}

function selectResult(url) {
    closeSearchModal();
    if (window.appRouter && typeof window.appRouter.handleRoute === 'function') {
        window.appRouter.handleRoute(url, true);
    } else {
        window.location.href = url;
    }
}

function performSearch(query) {
    const resultsContainer = document.getElementById('search-results-container');
    if (!resultsContainer) return;

    const trimmedQuery = query.trim().toLowerCase();

    const clearBtn = document.getElementById('global-search-clear');
    if (clearBtn) {
        clearBtn.style.display = trimmedQuery ? 'block' : 'none';
    }

    if (!trimmedQuery) {
        resultsContainer.innerHTML = `
            <div class="search-initial-state">
                <p class="search-hint-title">Search Across Incredible India</p>
                <p class="search-hint-desc">Discover heritage, cities, wildlife, sports, and culture instantly.</p>
                <div class="search-shortcuts">
                    <span class="search-shortcut-tag" data-query="Taj Mahal">Taj Mahal</span>
                    <span class="search-shortcut-tag" data-query="Biryani">Biryani</span>
                    <span class="search-shortcut-tag" data-query="Hornbill">Hornbill</span>
                    <span class="search-shortcut-tag" data-query="Kerala">Kerala</span>
                </div>
            </div>
        `;
        resultsContainer.querySelectorAll('.search-shortcut-tag').forEach(tag => {
            tag.addEventListener('click', () => {
                const input = document.getElementById('global-search-input');
                if (input) {
                    input.value = tag.dataset.query;
                    performSearch(tag.dataset.query);
                    input.focus();
                }
            });
        });
        return;
    }

    if (!window.indiaSearchIndex) {
        resultsContainer.innerHTML = `<div class="search-no-results">Loading search index...</div>`;
        return;
    }

    const matches = window.indiaSearchIndex.filter(item => {
        return item.title.toLowerCase().includes(trimmedQuery) ||
            item.category.toLowerCase().includes(trimmedQuery) ||
            item.description.toLowerCase().includes(trimmedQuery);
    });

    if (matches.length === 0) {
        resultsContainer.innerHTML = `
            <div class="search-no-results">
                <p>No results found for "${query}"</p>
                <p style="font-size: 0.9rem; margin-top: 5px;">Try searching for states, cuisines, monuments, or festivals.</p>
            </div>
        `;
        return;
    }

    let listHtml = '<ul class="search-results-list" role="listbox" id="search-results-list">';
    const limitedMatches = matches.slice(0, 10);

    limitedMatches.forEach((item, index) => {
        const highlightedTitle = highlightText(item.title, query);
        const prefix = getPathPrefix();
        const resolvedUrl = prefix + item.url;

        let icon = "🇮🇳";
        if (item.category.includes("Cuisine")) icon = "🍛";
        else if (item.category.includes("Festival")) icon = "🎉";
        else if (item.category.includes("Spiritual")) icon = "🕌";
        else if (item.category.includes("Wildlife")) icon = "🐯";
        else if (item.category.includes("Personalities")) icon = "👤";
        else if (item.category.includes("Heritage")) icon = "🏛️";
        else if (item.category.includes("Travel")) icon = "✈️";

        listHtml += `
            <li class="search-result-item" role="option" id="search-opt-${index}" data-index="${index}" data-url="${resolvedUrl}">
                <div class="search-result-icon">${icon}</div>
                <div class="search-result-content">
                    <div class="search-result-title-row">
                        <span class="search-result-title">${highlightedTitle}</span>
                        <span class="search-result-category">${item.category}</span>
                    </div>
                    <div class="search-result-desc">${item.description}</div>
                </div>
            </li>
        `;
    });

    listHtml += '</ul>';
    resultsContainer.innerHTML = listHtml;

    resultsContainer.querySelectorAll('.search-result-item').forEach(itemEl => {
        itemEl.addEventListener('click', () => {
            selectResult(itemEl.dataset.url);
        });
    });
}
