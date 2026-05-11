/*
 * If not stated otherwise in this file or this component's LICENSE
 * file the following copyright and licenses apply:
 *
 * Copyright 2024 RDK Management
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ── Sidebar Navigation ──────────────────────────────────────────────────────
const VALID_SECTIONS = [
  'section-dashboard', 'section-parameters', 'section-dac',
  'section-modules', 'section-iot', 'section-events'
];

function showSection(id) {
  if (!VALID_SECTIONS.includes(id)) return;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('section-active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('section-active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const escapedId = id; // id is already validated against VALID_SECTIONS allowlist
  const link = document.querySelector('.nav-item[data-section="' + escapedId + '"]');
  if (link) link.classList.add('active');
  localStorage.setItem('activeSection', id);
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const contentArea = document.querySelector('.content-area');
  if (!sidebar || !contentArea) return;
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.toggle('mobile-open');
  } else {
    sidebar.classList.toggle('collapsed');
    contentArea.classList.toggle('sidebar-collapsed');
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const saved = localStorage.getItem('activeSection');
  const initial = (saved && VALID_SECTIONS.includes(saved)) ? saved : 'section-dashboard';
  showSection(initial);

  // Keyboard support for nav items
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const sectionId = item.getAttribute('data-section');
        if (sectionId) showSection(sectionId);
      }
    });
  });
});

// ── End Sidebar Navigation ───────────────────────────────────────────────────

// Global state management
const USPController = {
    state: {
        autoRefresh: false,
        autoScroll: true,
        advancedMode: false,
        lastUpdate: new Date(),
        parameterHistory: [],
        searchResults: [],
        expandedNodes: new Set(),
        currentView: 'table'
    },
    
    config: {
        refreshInterval: 30000, // 30 seconds
        maxHistoryItems: 50,
        animationDuration: 300,
        searchDebounceDelay: 500
    }
};

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApplication();
    setupEventListeners();
    startPeriodicUpdates();
});

/**
 * Initialize the application
 */
function initializeApplication() {
    console.log('🚀 Initializing USP Controller...');
    
    // Update last update time
    updateLastUpdateTime();
    
    // Initialize tooltips
    initializeTooltips();
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Restore user preferences
    restoreUserPreferences();
    
    // Restore expanded tree nodes from localStorage
    restoreExpandedNodes();
    
    // Build category filter chips from the rendered tree
    buildCategoryChips();
    
    // Initialize search functionality
    initializeSearch();
    
    console.log('✅ USP Controller initialized');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Form submissions with loading states
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            showLoading();
            // Allow form to submit naturally
        });
    });
    
    // Parameter path selection enhancements
    const paramSelects = document.querySelectorAll('select[name="param_path"]');
    paramSelects.forEach(select => {
        select.addEventListener('change', function() {
            updateParameterSuggestions(this.value);
        });
    });
    
    // Real-time search for data model
    const searchInput = document.getElementById('model-search');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                filterDataModel(this.value);
            }, USPController.config.searchDebounceDelay);
        });
    }
    
    // Auto-dismiss messages
    const messages = document.querySelectorAll('.message');
    messages.forEach(message => {
        setTimeout(() => {
            if (message.parentElement) {
                fadeOut(message);
            }
        }, 5000);
    });
}

/**
 * Enhanced parameter selection with history and suggestions
 */
function selectParameter(path) {
    console.log(`📋 Selected parameter: ${path}`);
    
    // Update both get and set parameter dropdowns
    updateParameterDropdown('get-param-path', path);
    updateParameterDropdown('set-param-path', path);
    
    // Add to history
    addToParameterHistory(path);
    
    // Show parameter suggestions
    showParameterSuggestions(path);
    
    // Highlight in tree
    highlightTreeNode(path);
}

/**
 * Update parameter dropdown with new option
 */
function updateParameterDropdown(selectId, path) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // Check if option already exists
    let optionExists = false;
    for (let option of select.options) {
        if (option.value === path) {
            option.selected = true;
            optionExists = true;
            break;
        }
    }
    
    // Create new option if it doesn't exist
    if (!optionExists) {
        const option = document.createElement('option');
        option.value = path;
        option.text = path;
        option.selected = true;
        
        // Add to appropriate optgroup or create "Custom" group
        let customGroup = select.querySelector('optgroup[label="Custom Parameters"]');
        if (!customGroup) {
            customGroup = document.createElement('optgroup');
            customGroup.label = 'Custom Parameters';
            select.appendChild(customGroup);
        }
        customGroup.appendChild(option);
    }
    
    // Trigger change event
    select.dispatchEvent(new Event('change'));
}

/**
 * Add parameter to history
 */
function addToParameterHistory(path) {
    const history = USPController.state.parameterHistory;
    
    // Remove if already exists
    const existingIndex = history.indexOf(path);
    if (existingIndex > -1) {
        history.splice(existingIndex, 1);
    }
    
    // Add to beginning
    history.unshift(path);
    
    // Limit history size
    if (history.length > USPController.config.maxHistoryItems) {
        history.splice(USPController.config.maxHistoryItems);
    }
    
    // Save to localStorage
    localStorage.setItem('usp_parameter_history', JSON.stringify(history));
}

/**
 * Quick action functions
 */
function getDeviceInfo() {
    console.log('📱 Getting device information...');
    showLoading('Getting device information...');
    
    const deviceParams = [
        'Device.DeviceInfo.SerialNumber',
        'Device.DeviceInfo.Manufacturer',
        'Device.DeviceInfo.ModelName',
        'Device.DeviceInfo.SoftwareVersion',
        'Device.DeviceInfo.HardwareVersion'
    ];
    
    // Simulate getting multiple parameters
    fetchMultipleParameters(deviceParams, 'Device Information');
}

function getWiFiStatus() {
    console.log('📶 Getting WiFi status...');
    showLoading('Getting WiFi status...');
    
    const wifiParams = [
        'Device.WiFi.Radio.1.Enable',
        'Device.WiFi.SSID.1.SSID',
        'Device.WiFi.SSID.1.Enable',
        'Device.WiFi.Radio.1.Channel'
    ];
    
    fetchMultipleParameters(wifiParams, 'WiFi Status');
}

function getSystemStats() {
    console.log('📊 Getting system statistics...');
    showLoading('Getting system statistics...');
    
    const statsParams = [
        'Device.DeviceInfo.UpTime',
        'Device.DeviceInfo.MemoryStatus.Total',
        'Device.DeviceInfo.MemoryStatus.Free',
        'Device.DeviceInfo.ProcessorUsage'
    ];
    
    fetchMultipleParameters(statsParams, 'System Statistics');
}

/**
 * Fetch multiple parameters (simulated for demo)
 */
function fetchMultipleParameters(params, title) {
    // In a real implementation, this would make API calls
    setTimeout(() => {
        hideLoading();
        showNotification(`${title} retrieved successfully`, 'success');
    }, 2000);
}

/**
 * Advanced configuration functions
 */
function toggleAdvancedMode() {
    USPController.state.advancedMode = !USPController.state.advancedMode;
    const button = event.target.closest('button');
    
    if (USPController.state.advancedMode) {
        button.innerHTML = '<i class="fas fa-tools"></i> Basic';
        showAdvancedConfig();
    } else {
        button.innerHTML = '<i class="fas fa-tools"></i> Advanced';
        hideAdvancedConfig();
    }
    
    console.log(`🔧 Advanced mode: ${USPController.state.advancedMode ? 'ON' : 'OFF'}`);
}

function showAdvancedConfig() {
    // Add advanced configuration options
    const configForm = document.querySelector('.config-form');
    if (!configForm.querySelector('.advanced-config')) {
        const advancedDiv = document.createElement('div');
        advancedDiv.className = 'advanced-config';
        advancedDiv.innerHTML = `
            <div class="config-group">
                <label for="retry-count">Retry Count</label>
                <input type="number" id="retry-count" name="retry_count" value="3" class="config-input" min="1" max="10">
            </div>
            <div class="config-group">
                <label for="log-level">Log Level</label>
                <select id="log-level" name="log_level" class="config-input">
                    <option value="INFO">INFO</option>
                    <option value="DEBUG">DEBUG</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                </select>
            </div>
        `;
        configForm.insertBefore(advancedDiv, configForm.querySelector('.config-actions'));
        slideDown(advancedDiv);
    }
}

function hideAdvancedConfig() {
    const advancedDiv = document.querySelector('.advanced-config');
    if (advancedDiv) {
        slideUp(advancedDiv, () => advancedDiv.remove());
    }
}

/**
 * Application management functions
 */
function updateAppDescription() {
    const appSelect = document.getElementById('app-name');
    const descDiv = document.getElementById('app-description');
    const selectedOption = appSelect.options[appSelect.selectedIndex];
    
    if (selectedOption && selectedOption.dataset.desc) {
        descDiv.innerHTML = `
            <i class="fas fa-info-circle"></i>
            <strong>${selectedOption.text}:</strong> ${selectedOption.dataset.desc}
        `;
        descDiv.className = 'app-description active';
    } else {
        descDiv.innerHTML = 'Select an application to see its description';
        descDiv.className = 'app-description';
    }
}

function updateLocationInfo() {
    const locationSelect = document.getElementById('app-location');
    const selectedOption = locationSelect.options[locationSelect.selectedIndex];
    
    if (selectedOption && selectedOption.dataset.desc) {
        console.log(`📍 Location: ${selectedOption.text} - ${selectedOption.dataset.desc}`);
    }
}

function validateInstallation() {
    const name = document.getElementById('app-name').value;
    const location = document.getElementById('app-location').value;
    const version = document.getElementById('app-version').value;
    
    if (!name || !location || !version) {
        showNotification('Please select application, location, and version', 'warning');
        return false;
    }
    
    showNotification('Installation parameters validated successfully', 'success');
    return true;
}

function refreshApplicationList() {
    console.log('🔄 Refreshing application list...');
    showLoading('Refreshing application list...');
    
    // Simulate refresh
    setTimeout(() => {
        hideLoading();
        showNotification('Application list refreshed', 'success');
    }, 1500);
}

/**
 * Module management functions
 */
function showEEDetails(index) {
    console.log(`ℹ️ Showing EE details for index: ${index}`);
    showModal('Execution Environment Details', `Details for EE ${index} would be shown here.`);
}

function showDUDetails(index) {
    console.log(`ℹ️ Showing DU details for index: ${index}`);
    showModal('Deployment Unit Details', `Details for DU ${index} would be shown here.`);
}

function showEUDetails(index) {
    console.log(`ℹ️ Showing EU details for index: ${index}`);
    showModal('Execution Unit Details', `Details for EU ${index} would be shown here.`);
}

function confirmUninstall(name) {
    return confirm(`Are you sure you want to uninstall "${name}"?\n\nThis action cannot be undone.`);
}

function exportModuleData() {
    console.log('📊 Exporting module data...');
    showLoading('Preparing export...');
    
    // Simulate data preparation
    setTimeout(() => {
        hideLoading();
        
        // Create mock data
        const data = {
            timestamp: new Date().toISOString(),
            modules: {
                executionEnvironments: [],
                deploymentUnits: [],
                executionUnits: []
            }
        };
        
        downloadJSON(data, 'usp-modules-export.json');
        showNotification('Module data exported successfully', 'success');
    }, 2000);
}

function toggleModuleView() {
    USPController.state.currentView = USPController.state.currentView === 'table' ? 'grid' : 'table';
    console.log(`🔄 Switched to ${USPController.state.currentView} view`);
    
    // Update button text
    const button = event.target.closest('button');
    button.innerHTML = USPController.state.currentView === 'table' ? 
        '<i class="fas fa-th"></i> Grid View' : 
        '<i class="fas fa-th-list"></i> Table View';
}

/**
 * Data model functions
 */
function expandAllNodes() {
    console.log('📂 Expanding all data model nodes...');
    document.querySelectorAll('.node-children').forEach(el => {
        el.style.display = '';
    });
    document.querySelectorAll('.node-toggle').forEach(el => {
        el.textContent = '▼';
    });
    showNotification('All nodes expanded', 'info');
}

function collapseAllNodes() {
    console.log('📁 Collapsing all data model nodes...');
    document.querySelectorAll('.node-children').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.node-toggle').forEach(el => {
        el.textContent = '▶';
    });
    showNotification('All nodes collapsed', 'info');
}

function toggleNode(toggleEl) {
    const objectNode = toggleEl.closest('.tree-node.object');
    if (!objectNode) return;
    const childrenEl = objectNode.nextElementSibling;
    if (!childrenEl || !childrenEl.classList.contains('node-children')) return;

    const isExpanded = childrenEl.style.display !== 'none';
    childrenEl.style.display = isExpanded ? 'none' : '';
    toggleEl.textContent = isExpanded ? '▶' : '▼';

    const path = objectNode.dataset.path;
    if (path) {
        try {
            const expanded = JSON.parse(localStorage.getItem('usp_expanded_nodes') || '[]');
            if (isExpanded) {
                const idx = expanded.indexOf(path);
                if (idx > -1) expanded.splice(idx, 1);
            } else {
                if (!expanded.includes(path)) expanded.push(path);
            }
            localStorage.setItem('usp_expanded_nodes', JSON.stringify(expanded));
        } catch (e) { /* ignore localStorage errors */ }
    }
}

function restoreExpandedNodes() {
    try {
        const expanded = JSON.parse(localStorage.getItem('usp_expanded_nodes') || '[]');
        // Use dataset comparison to avoid CSS selector injection from stored paths
        const objectNodes = Array.from(document.querySelectorAll('.tree-node.object'));
        expanded.forEach(path => {
            const node = objectNodes.find(n => n.dataset.path === path);
            if (node) {
                const childrenEl = node.nextElementSibling;
                const toggle = node.querySelector('.node-toggle');
                if (childrenEl && childrenEl.classList.contains('node-children')) {
                    childrenEl.style.display = '';
                    if (toggle) toggle.textContent = '▼';
                }
            }
        });
    } catch (e) { /* ignore */ }
}

function searchDataModel() {
    const searchTerm = prompt('Enter search term for data model:');
    if (searchTerm !== null) {
        const input = document.getElementById('model-search');
        if (input) {
            input.value = searchTerm;
            filterDataModel(searchTerm.trim());
        }
    }
}

function highlightText(element, query) {
    const text = element.textContent;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return;

    // Build highlight using DOM nodes (avoids innerHTML injection risk)
    const before = document.createTextNode(text.substring(0, index));
    const highlight = document.createElement('span');
    highlight.className = 'highlight';
    highlight.textContent = text.substring(index, index + query.length);
    const after = document.createTextNode(text.substring(index + query.length));

    element.textContent = '';
    element.appendChild(before);
    element.appendChild(highlight);
    element.appendChild(after);
}

function updateResultCount(count, cleared) {
    const badge = document.getElementById('search-result-count');
    if (!badge) return;
    if (cleared) {
        badge.textContent = '';
        badge.style.display = 'none';
    } else {
        badge.textContent = `${count} result${count !== 1 ? 's' : ''}`;
        badge.style.display = 'inline-block';
    }
}

function filterDataModel(query) {
    const tree = document.getElementById('data-model-tree');
    if (!tree) return;

    // Remove existing highlights and normalize adjacent text nodes
    tree.querySelectorAll('.highlight').forEach(el => {
        const parent = el.parentNode;
        el.replaceWith(document.createTextNode(el.textContent));
        if (parent) parent.normalize();
    });

    if (!query) {
        tree.querySelectorAll('.tree-node').forEach(n => { n.style.display = ''; });
        tree.querySelectorAll('.node-children').forEach(n => { n.style.display = 'none'; });
        updateResultCount(0, true);
        return;
    }

    const lowerQuery = query.toLowerCase();
    let matchCount = 0;

    // Hide everything first
    tree.querySelectorAll('.tree-node').forEach(n => { n.style.display = 'none'; });
    tree.querySelectorAll('.node-children').forEach(n => { n.style.display = 'none'; });

    // Show matching parameter nodes and their ancestors
    tree.querySelectorAll('.tree-node.parameter').forEach(node => {
        const path = (node.dataset.path || '').toLowerCase();
        const text = node.textContent.toLowerCase();
        if (path.includes(lowerQuery) || text.includes(lowerQuery)) {
            node.style.display = '';
            matchCount++;
            // Highlight the param-name
            const nameEl = node.querySelector('.param-name');
            if (nameEl) highlightText(nameEl, query);
            // Walk up and show all ancestor node-children + their sibling object nodes
            let parent = node.parentElement;
            while (parent && parent !== tree) {
                if (parent.classList.contains('node-children')) {
                    parent.style.display = '';
                    const objNode = parent.previousElementSibling;
                    if (objNode && objNode.classList.contains('tree-node')) {
                        objNode.style.display = '';
                    }
                }
                parent = parent.parentElement;
            }
        }
    });

    updateResultCount(matchCount, false);
    console.log(`🔍 Search "${query}" found ${matchCount} matches`);
    if (matchCount === 0) showNotification('No matches found', 'warning');
}

function clearSearch() {
    const input = document.getElementById('model-search');
    if (input) {
        input.value = '';
        filterDataModel('');
    }
}

/**
 * Inline parameter refresh (live value fetch)
 */
async function refreshParam(path) {
    const safeId = path.replace(/\./g, '-');
    const valueEl = document.getElementById('val-' + safeId);
    if (!valueEl) return;

    valueEl.classList.add('loading');
    valueEl.classList.remove('updated', 'error');

    try {
        const resp = await fetch(`/api/get_parameter_ajax?path=${encodeURIComponent(path)}`);
        const data = await resp.json();
        valueEl.classList.remove('loading');

        if (data.success && data.data) {
            const newValue = Object.values(data.data)[0];
            valueEl.textContent = (newValue !== undefined && newValue !== null) ? newValue : 'N/A';
            valueEl.classList.add('updated');
            setTimeout(() => valueEl.classList.remove('updated'), 2000);
        } else {
            valueEl.classList.add('error');
            setTimeout(() => valueEl.classList.remove('error'), 2000);
            showNotification(`Refresh failed: ${data.error || 'No data'}`, 'warning');
        }
    } catch (e) {
        valueEl.classList.remove('loading');
        valueEl.classList.add('error');
        setTimeout(() => valueEl.classList.remove('error'), 2000);
        showNotification(`Refresh error: ${e.message}`, 'error');
    }
}

/**
 * Inline parameter edit
 */
/**
 * Find a parameter tree node by its data-path value without CSS selector injection risk
 */
function findParamNode(path) {
    return Array.from(document.querySelectorAll('.tree-node.parameter')).find(
        n => n.dataset.path === path
    ) || null;
}

function editParam(path) {
    const safeId = path.replace(/\./g, '-');
    const valueEl = document.getElementById('val-' + safeId);
    if (!valueEl) return;
    // Don't open a second editor
    if (valueEl.parentElement.querySelector('.inline-edit-container')) return;

    const currentValue = valueEl.textContent;
    const editContainer = document.createElement('div');
    editContainer.className = 'inline-edit-container';
    // Escape backslashes first, then single quotes for JS string in onclick attribute
    const escapedPath = path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    editContainer.innerHTML =
        `<input type="text" class="inline-edit-input" value="">` +
        `<button class="btn-save-param" onclick="saveParam('${escapedPath}', this.previousElementSibling.value)">✓</button>` +
        `<button class="btn-cancel-param" onclick="cancelEdit('${escapedPath}')">✗</button>`;

    valueEl.style.display = 'none';
    valueEl.insertAdjacentElement('afterend', editContainer);
    const input = editContainer.querySelector('.inline-edit-input');
    input.value = currentValue;
    input.focus();
    input.select();
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') saveParam(path, this.value);
        if (e.key === 'Escape') cancelEdit(path);
    });
}

async function saveParam(path, newValue) {
    const safeId = path.replace(/\./g, '-');
    const valueEl = document.getElementById('val-' + safeId);
    const paramNode = findParamNode(path);
    const editContainer = paramNode ? paramNode.querySelector('.inline-edit-container') : null;

    try {
        const resp = await fetch('/api/set_parameter_ajax', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path: path, value: newValue})
        });
        const data = await resp.json();

        if (data.success) {
            if (valueEl) {
                valueEl.textContent = newValue;
                valueEl.style.display = '';
                valueEl.classList.add('updated');
                setTimeout(() => valueEl.classList.remove('updated'), 2000);
            }
            if (editContainer) editContainer.remove();
            showNotification(`Saved: ${path}`, 'success');
        } else {
            showNotification(`Failed to set ${path}: ${data.error || 'Unknown error'}`, 'error');
            cancelEdit(path);
        }
    } catch (e) {
        showNotification(`Error setting ${path}: ${e.message}`, 'error');
        cancelEdit(path);
    }
}

function cancelEdit(path) {
    const safeId = path.replace(/\./g, '-');
    const valueEl = document.getElementById('val-' + safeId);
    const paramNode = findParamNode(path);
    const editContainer = paramNode ? paramNode.querySelector('.inline-edit-container') : null;
    if (valueEl) valueEl.style.display = '';
    if (editContainer) editContainer.remove();
}

/**
 * Copy path to clipboard
 */
function copyPath(path) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(path).then(() => {
            showNotification(`Copied: ${path}`, 'success');
        }).catch(() => fallbackCopy(path));
    } else {
        fallbackCopy(path);
    }
}

function fallbackCopy(path) {
    const ta = document.createElement('textarea');
    ta.value = path;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); showNotification(`Copied: ${path}`, 'success'); }
    catch (e) { showNotification('Copy failed', 'error'); }
    document.body.removeChild(ta);
}

/**
 * Lazy-load a large model sub-tree
 */
async function expandLargeModel(path, el) {
    el.innerHTML = '⟳ Loading...';
    el.style.cursor = 'wait';

    try {
        const resp = await fetch(`/api/expand_model?path=${encodeURIComponent(path)}`);
        const data = await resp.json();

        if (data.success && data.html) {
            const container = el.parentElement;
            el.remove();
            container.insertAdjacentHTML('beforeend', data.html);
        } else {
            el.innerHTML = `❌ Failed to load: ${data.error || 'Unknown error'}`;
            el.style.cursor = 'pointer';
        }
    } catch (e) {
        el.innerHTML = `❌ Error: ${e.message}`;
        el.style.cursor = 'pointer';
    }
}

/**
 * Category/namespace filter
 */
function buildCategoryChips() {
    const tree = document.getElementById('data-model-tree');
    const chipsContainer = document.getElementById('category-chips');
    if (!tree || !chipsContainer) return;

    const categories = new Set(['All']);
    tree.querySelectorAll('.tree-node.object[data-category]').forEach(node => {
        const cat = node.dataset.category;
        if (cat) categories.add(cat);
    });

    chipsContainer.innerHTML = '';
    categories.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = 'category-chip' + (cat === 'All' ? ' active' : '');
        chip.dataset.category = cat;
        chip.textContent = cat;
        chip.addEventListener('click', () => filterByCategory(cat));
        chipsContainer.appendChild(chip);
    });
}

function filterByCategory(category) {
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.category === category);
    });

    const tree = document.getElementById('data-model-tree');
    if (!tree) return;

    // Only filter direct children (top-level object nodes)
    let el = tree.firstElementChild;
    while (el) {
        const next = el.nextElementSibling;
        if (el.classList.contains('tree-node') && el.classList.contains('object')) {
            const cat = el.dataset.category || '';
            const visible = category === 'All' || cat === category;
            el.style.display = visible ? '' : 'none';
            if (next && next.classList.contains('node-children')) {
                if (!visible) {
                    next.style.display = 'none';
                } else {
                    const toggle = el.querySelector('.node-toggle');
                    if (toggle && toggle.textContent === '▼') {
                        next.style.display = '';
                    }
                }
                el = next.nextElementSibling;
                continue;
            }
        }
        el = next;
    }
}

function highlightTreeNode(path) {
    // Remove previous highlights
    document.querySelectorAll('.tree-node.highlighted').forEach(node => {
        node.classList.remove('highlighted');
    });
    
    // Find node by dataset to avoid CSS selector injection
    const node = Array.from(document.querySelectorAll('.tree-node[data-path]')).find(
        n => n.dataset.path === path
    );
    if (node) {
        node.classList.add('highlighted');
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Logging functions
 */
function refreshLogs() {
    console.log('📄 Refreshing logs...');
    showLoading('Refreshing logs...');
    
    // In a real implementation, this would fetch new logs
    setTimeout(() => {
        hideLoading();
        showNotification('Logs refreshed', 'success');
        updateLastUpdateTime();
    }, 1000);
}

function clearLogs() {
    if (confirm('Are you sure you want to clear all logs?')) {
        const logsContainer = document.getElementById('system-logs');
        if (logsContainer) {
            logsContainer.innerHTML = '<div class="log-entry">Logs cleared by user</div>';
            showNotification('Logs cleared', 'info');
        }
    }
}

function downloadLogs() {
    console.log('💾 Downloading logs...');
    const logs = document.querySelectorAll('.log-entry');
    const logText = Array.from(logs).map(log => log.textContent).join('\n');
    
    downloadText(logText, 'usp-controller-logs.txt');
    showNotification('Logs downloaded', 'success');
}

function toggleAutoScroll() {
    USPController.state.autoScroll = !USPController.state.autoScroll;
    const button = event.target.closest('button');
    
    if (USPController.state.autoScroll) {
        button.innerHTML = '<i class="fas fa-pause"></i> Pause Scroll';
        button.classList.remove('btn-primary');
        button.classList.add('btn-warning');
    } else {
        button.innerHTML = '<i class="fas fa-arrows-alt-v"></i> Auto Scroll';
        button.classList.remove('btn-warning');
        button.classList.add('btn-primary');
    }
    
    console.log(`📜 Auto scroll: ${USPController.state.autoScroll ? 'ON' : 'OFF'}`);
}

/**
 * Utility functions
 */
function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const text = overlay.querySelector('.loading-text');
    
    if (text) text.textContent = message;
    overlay.style.display = 'flex';
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas ${getNotificationIcon(type)}"></i>
        <span>${message}</span>
        <button type="button" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            fadeOut(notification, () => notification.remove());
        }
    }, 5000);
    
    console.log(`🔔 Notification (${type}): ${message}`);
}

function getNotificationIcon(type) {
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    return icons[type] || 'fa-info-circle';
}

function showModal(title, content) {
    // Create modal (simplified version)
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function updateLastUpdateTime() {
    USPController.state.lastUpdate = new Date();
    const element = document.getElementById('last-update');
    if (element) {
        element.textContent = USPController.state.lastUpdate.toLocaleTimeString();
    }
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Animation utilities
 */
function fadeOut(element, callback) {
    element.style.opacity = '1';
    element.style.transition = `opacity ${USPController.config.animationDuration}ms ease-out`;
    element.style.opacity = '0';
    
    setTimeout(() => {
        if (callback) callback();
    }, USPController.config.animationDuration);
}

function slideDown(element) {
    element.style.height = '0';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${USPController.config.animationDuration}ms ease-out`;
    
    setTimeout(() => {
        element.style.height = element.scrollHeight + 'px';
        setTimeout(() => {
            element.style.height = '';
            element.style.overflow = '';
        }, USPController.config.animationDuration);
    }, 10);
}

function slideUp(element, callback) {
    element.style.height = element.scrollHeight + 'px';
    element.style.overflow = 'hidden';
    element.style.transition = `height ${USPController.config.animationDuration}ms ease-out`;
    
    setTimeout(() => {
        element.style.height = '0';
        setTimeout(() => {
            if (callback) callback();
        }, USPController.config.animationDuration);
    }, 10);
}

/**
 * Periodic updates and auto-refresh
 */
function startPeriodicUpdates() {
    setInterval(() => {
        if (USPController.state.autoRefresh) {
            updateLastUpdateTime();
            // In a real implementation, refresh data here
        }
    }, USPController.config.refreshInterval);
}

/**
 * User preferences management
 */
function saveUserPreferences() {
    const preferences = {
        autoRefresh: USPController.state.autoRefresh,
        autoScroll: USPController.state.autoScroll,
        advancedMode: USPController.state.advancedMode,
        currentView: USPController.state.currentView,
        expandedNodes: Array.from(USPController.state.expandedNodes)
    };
    
    localStorage.setItem('usp_controller_preferences', JSON.stringify(preferences));
}

function restoreUserPreferences() {
    try {
        const saved = localStorage.getItem('usp_controller_preferences');
        if (saved) {
            const preferences = JSON.parse(saved);
            Object.assign(USPController.state, preferences);
            USPController.state.expandedNodes = new Set(preferences.expandedNodes || []);
        }
    } catch (error) {
        console.warn('Failed to restore user preferences:', error);
    }
}

/**
 * Keyboard shortcuts
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + R: Refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            window.location.reload();
        }
        
        // Ctrl/Cmd + F: Search data model
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            const searchInput = document.getElementById('model-search');
            if (searchInput) {
                searchInput.focus();
            }
        }
        
        // Escape: Close modals
        if (e.key === 'Escape') {
            const modals = document.querySelectorAll('.modal-overlay');
            modals.forEach(modal => modal.remove());
        }
    });
}

/**
 * Initialize tooltips (simplified)
 */
function initializeTooltips() {
    const tooltipElements = document.querySelectorAll('[title]');
    tooltipElements.forEach(element => {
        element.addEventListener('mouseenter', showTooltip);
        element.addEventListener('mouseleave', hideTooltip);
    });
}

function showTooltip(e) {
    // Simplified tooltip implementation
    console.log(`💡 Tooltip: ${e.target.title}`);
}

function hideTooltip(e) {
    // Hide tooltip implementation
}

/**
 * Initialize search functionality
 */
function initializeSearch() {
    // Setup search functionality for different components
    console.log('🔍 Search functionality initialized');
}

/**
 * Copy result to clipboard
 */
function copyResult() {
    const resultContent = document.querySelector('.result-content');
    if (resultContent) {
        navigator.clipboard.writeText(resultContent.textContent).then(() => {
            showNotification('Result copied to clipboard', 'success');
        }).catch(() => {
            showNotification('Failed to copy result', 'error');
        });
    }
}

/**
 * Legacy compatibility functions
 */
function toggleParameterHistory() {
    console.log('📋 Parameter history feature not yet implemented');
    showNotification('Parameter history feature coming soon', 'info');
}

function refreshParameterList() {
    console.log('🔄 Refreshing parameter list...');
    showNotification('Parameter list refreshed', 'success');
}

function updateParameterSuggestions(path) {
    // Provide suggestions based on selected parameter
    if (path) {
        console.log(`💡 Suggestions for: ${path}`);
    }
}

function showParameterSuggestions(path) {
    // Show contextual suggestions
    console.log(`💡 Showing suggestions for: ${path}`);
}

// Save preferences before page unload
window.addEventListener('beforeunload', saveUserPreferences);

// Export global functions for backward compatibility
window.selectParameter = selectParameter;
window.toggleAdvancedMode = toggleAdvancedMode;
window.updateAppDescription = updateAppDescription;
window.updateLocationInfo = updateLocationInfo;
window.validateInstallation = validateInstallation;
window.refreshApplicationList = refreshApplicationList;
window.showEEDetails = showEEDetails;
window.showDUDetails = showDUDetails;
window.showEUDetails = showEUDetails;
window.confirmUninstall = confirmUninstall;
window.exportModuleData = exportModuleData;
window.toggleModuleView = toggleModuleView;
window.expandAllNodes = expandAllNodes;
window.collapseAllNodes = collapseAllNodes;
window.searchDataModel = searchDataModel;
window.refreshLogs = refreshLogs;
window.clearLogs = clearLogs;
window.downloadLogs = downloadLogs;
window.toggleAutoScroll = toggleAutoScroll;
window.copyResult = copyResult;
window.toggleParameterHistory = toggleParameterHistory;
window.refreshParameterList = refreshParameterList;
// Data model browser functions
window.toggleNode = toggleNode;
window.filterDataModel = filterDataModel;
window.clearSearch = clearSearch;
window.refreshParam = refreshParam;
window.editParam = editParam;
window.saveParam = saveParam;
window.cancelEdit = cancelEdit;
window.copyPath = copyPath;
window.expandLargeModel = expandLargeModel;
window.filterByCategory = filterByCategory;

console.log('🎯 Enhanced USP Controller JavaScript loaded successfully');
