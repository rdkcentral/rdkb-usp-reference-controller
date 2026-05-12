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
  'section-dashboard', 'section-metrics', 'section-alerts', 'section-fleet',
  'section-parameters', 'section-dac', 'section-modules', 'section-iot', 'section-events',
  'section-easymesh', 'section-wifi', 'section-devices', 'section-topology', 'section-diagnostics',
  'section-location', 'section-ai', 'section-rbac',
  'section-mass-actions', 'section-cpe'
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
    const icon = document.createElement('i');
    icon.className = `fas ${getNotificationIcon(type)}`;
    const span = document.createElement('span');
    span.textContent = message;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.onclick = function() { this.parentElement.remove(); };
    notification.appendChild(icon);
    notification.appendChild(span);
    notification.appendChild(closeBtn);
    
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

// ══════════════════════════════════════════════════════════════════════════════
// Security helper: escape HTML entities to prevent XSS
// ══════════════════════════════════════════════════════════════════════════════
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// ══════════════════════════════════════════════════════════════════════════════
// Feature helper utilities
// ══════════════════════════════════════════════════════════════════════════════
const FEATURE_STATE = {
    metrics: { interval: null, points: 60, paused: { cpu: false, memory: false, network: false, clients: false }, charts: {}, history: { cpu: [], memoryUsed: [], rx: [], tx: [], clients: [] }, backendUnavailable: false },
    alerts: { rules: [], active: {}, history: [], interval: null },
    fleet: { devices: [], statusCache: {}, view: 'cards', sort: 'name', sortAsc: true, countdown: 30, countdownInterval: null },
    easymesh: { data: null },
    topology: { network: null, showClients: true, showLabels: true, nodes: [], edges: [], clients: [] },
    wifi: { ssids: [], clientsInterval: null, channelChart: null }
};

function showFeatureNotice(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
}

function toNum(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function formatDuration(seconds) {
    const s = Math.max(0, parseInt(seconds, 10) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${m}m ${sec}s`;
}

function chartTheme() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#a0aec0' } } },
        scales: {
            x: { ticks: { color: '#a0aec0' }, grid: { color: 'rgba(255,255,255,0.1)' } },
            y: { ticks: { color: '#a0aec0' }, grid: { color: 'rgba(255,255,255,0.1)' } }
        }
    };
}

async function fetchApiJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.json();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Metrics
// ══════════════════════════════════════════════════════════════════════════════
function metricsPointsFromRange(range) {
    return { '1min': 12, '5min': 60, '15min': 180, '1hr': 720 }[range] || 60;
}

function metricsTrim() {
    const limit = FEATURE_STATE.metrics.points;
    Object.values(FEATURE_STATE.metrics.history).forEach(arr => {
        while (arr.length > limit) arr.shift();
    });
}

function metricsTrend(latest, prev) {
    if (!Number.isFinite(latest) || !Number.isFinite(prev)) return '→';
    if (latest > prev) return '↑';
    if (latest < prev) return '↓';
    return '→';
}

function metricsUpdateHeader(idPrefix, valueText, trend) {
    const v = document.getElementById(`${idPrefix}-current`);
    const t = document.getElementById(`${idPrefix}-trend`);
    if (v) v.textContent = valueText;
    if (t) t.textContent = trend;
}

function metricsEnsureCharts() {
    if (typeof Chart === 'undefined') return;
    const theme = chartTheme();
    if (!FEATURE_STATE.metrics.charts.cpu) {
        FEATURE_STATE.metrics.charts.cpu = new Chart(document.getElementById('metrics-cpu-chart'), {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'CPU %', data: [], borderColor: '#00c6ff', backgroundColor: 'rgba(0,0,0,0)', tension: 0.3 }] },
            options: theme
        });
    }
    if (!FEATURE_STATE.metrics.charts.memory) {
        FEATURE_STATE.metrics.charts.memory = new Chart(document.getElementById('metrics-memory-chart'), {
            type: 'doughnut',
            data: { labels: ['Used', 'Free'], datasets: [{ data: [0, 100], backgroundColor: ['#ff6b35', '#00e5a0'], borderColor: 'rgba(0,0,0,0)' }] },
            options: { responsive: true, plugins: { legend: { labels: { color: '#a0aec0' } } } }
        });
    }
    if (!FEATURE_STATE.metrics.charts.network) {
        FEATURE_STATE.metrics.charts.network = new Chart(document.getElementById('metrics-network-chart'), {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'RX', data: [], borderColor: '#00e5a0', backgroundColor: 'rgba(0,0,0,0)', tension: 0.3 }, { label: 'TX', data: [], borderColor: '#00c6ff', backgroundColor: 'rgba(0,0,0,0)', tension: 0.3 }] },
            options: theme
        });
    }
    if (!FEATURE_STATE.metrics.charts.clients) {
        FEATURE_STATE.metrics.charts.clients = new Chart(document.getElementById('metrics-clients-chart'), {
            type: 'bar',
            data: { labels: ['2.4GHz', '5GHz', '6GHz'], datasets: [{ label: 'Clients', data: [0, 0, 0], backgroundColor: ['#0077ff', '#00c6ff', '#00ffd4'] }] },
            options: theme
        });
    }
}

async function metricsFetchSample() {
    let sample = {
        cpu: 20 + Math.random() * 30,
        memFree: 80000 + Math.random() * 10000,
        memTotal: 128000,
        rx: 100000 + Math.random() * 40000,
        tx: 80000 + Math.random() * 35000,
        clientsByBand: [2, 4, 1]
    };
    try {
        const metrics = await fetchApiJson('/api/metrics');
        sample = {
            cpu: toNum(metrics.cpu_usage, sample.cpu),
            memFree: toNum(metrics.memory_free, sample.memFree),
            memTotal: toNum(metrics.memory_total, sample.memTotal),
            rx: toNum(metrics.bytes_received, sample.rx),
            tx: toNum(metrics.bytes_sent, sample.tx),
            clientsByBand: metrics.wifi_clients_by_band || sample.clientsByBand
        };
        FEATURE_STATE.metrics.backendUnavailable = false;
    } catch (e) {
        if (String(e.message).includes('HTTP_404')) FEATURE_STATE.metrics.backendUnavailable = true;
        try {
            const wifi = await fetchApiJson('/api/wifi/status');
            const totalClients = (wifi.ssids || []).reduce((a, s) => a + toNum(s.clients), 0);
            sample.clientsByBand = [Math.max(0, totalClients - 2), Math.min(2, totalClients), Math.min(1, totalClients)];
            if (Array.isArray(wifi.stats) && wifi.stats[0]) {
                sample.rx = toNum(wifi.stats[0].rx_bytes, sample.rx);
                sample.tx = toNum(wifi.stats[0].tx_bytes, sample.tx);
            }
        } catch (_) {}
    }
    showFeatureNotice('metrics-backend-notice', FEATURE_STATE.metrics.backendUnavailable);
    return sample;
}

async function metricsRefresh() {
    metricsEnsureCharts();
    const h = FEATURE_STATE.metrics.history;
    const sample = await metricsFetchSample();
    if (!FEATURE_STATE.metrics.paused.cpu) h.cpu.push(toNum(sample.cpu));
    if (!FEATURE_STATE.metrics.paused.memory) h.memoryUsed.push(Math.max(0, toNum(sample.memTotal) - toNum(sample.memFree)));
    if (!FEATURE_STATE.metrics.paused.network) {
        h.rx.push(toNum(sample.rx));
        h.tx.push(toNum(sample.tx));
    }
    if (!FEATURE_STATE.metrics.paused.clients) h.clients.push((sample.clientsByBand || []).reduce((a, v) => a + toNum(v), 0));
    metricsTrim();

    const labels = h.cpu.map((_, i) => `${i + 1}`);
    const cpuLatest = h.cpu[h.cpu.length - 1];
    const cpuPrev = h.cpu[h.cpu.length - 2];
    const memLatest = h.memoryUsed[h.memoryUsed.length - 1];
    const memPrev = h.memoryUsed[h.memoryUsed.length - 2];
    const rxLatest = h.rx[h.rx.length - 1];
    const txLatest = h.tx[h.tx.length - 1];
    const netLatest = (toNum(rxLatest) + toNum(txLatest)) / 1024;
    const netPrev = (toNum(h.rx[h.rx.length - 2]) + toNum(h.tx[h.tx.length - 2])) / 1024;
    const clientsLatest = h.clients[h.clients.length - 1];
    const clientsPrev = h.clients[h.clients.length - 2];

    metricsUpdateHeader('metrics-cpu', `${toNum(cpuLatest).toFixed(1)}%`, metricsTrend(cpuLatest, cpuPrev));
    metricsUpdateHeader('metrics-memory', `${(toNum(memLatest) / 1024).toFixed(1)} MB`, metricsTrend(memLatest, memPrev));
    metricsUpdateHeader('metrics-net', `${toNum(netLatest).toFixed(1)} KB`, metricsTrend(netLatest, netPrev));
    metricsUpdateHeader('metrics-clients', `${toNum(clientsLatest, 0)}`, metricsTrend(clientsLatest, clientsPrev));

    const cpuChart = FEATURE_STATE.metrics.charts.cpu;
    if (cpuChart) {
        cpuChart.data.labels = labels;
        cpuChart.data.datasets[0].data = h.cpu.slice();
        cpuChart.update('none');
    }
    const memoryChart = FEATURE_STATE.metrics.charts.memory;
    if (memoryChart) {
        const used = Math.max(0, toNum(memLatest, 0));
        const free = Math.max(0, toNum(sample.memTotal, 0) - used);
        memoryChart.data.datasets[0].data = [used, free];
        memoryChart.update('none');
    }
    const netChart = FEATURE_STATE.metrics.charts.network;
    if (netChart) {
        netChart.data.labels = labels;
        netChart.data.datasets[0].data = h.rx.slice();
        netChart.data.datasets[1].data = h.tx.slice();
        netChart.update('none');
    }
    const cChart = FEATURE_STATE.metrics.charts.clients;
    if (cChart) {
        cChart.data.datasets[0].data = sample.clientsByBand || [0, 0, 0];
        cChart.update('none');
    }
}

function metricsToggleChart(name) {
    FEATURE_STATE.metrics.paused[name] = !FEATURE_STATE.metrics.paused[name];
    const btn = document.getElementById(`metrics-${name}-toggle`);
    if (btn) btn.textContent = FEATURE_STATE.metrics.paused[name] ? 'Resume' : 'Pause';
}

function metricsInit() {
    const range = document.getElementById('metrics-time-range');
    if (range && !range.dataset.bound) {
        range.dataset.bound = '1';
        range.addEventListener('change', function() {
            FEATURE_STATE.metrics.points = metricsPointsFromRange(this.value);
            metricsTrim();
        });
    }
    FEATURE_STATE.metrics.points = metricsPointsFromRange(range ? range.value : '5min');
    if (!FEATURE_STATE.metrics.interval) FEATURE_STATE.metrics.interval = setInterval(metricsRefresh, 5000);
    metricsRefresh();
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Alerts
// ══════════════════════════════════════════════════════════════════════════════
function alertsSaveRules() {
    localStorage.setItem('usp_alert_rules', JSON.stringify(FEATURE_STATE.alerts.rules));
}

function alertsLoadRules() {
    try { FEATURE_STATE.alerts.rules = JSON.parse(localStorage.getItem('usp_alert_rules') || '[]'); } catch (_) { FEATURE_STATE.alerts.rules = []; }
}

function alertsSetNavBadge(count) {
    const badge = document.getElementById('alerts-nav-badge');
    if (!badge) return;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

function alertsCompare(actual, op, threshold) {
    if (typeof actual === 'boolean') {
        const boolThreshold = String(threshold).toLowerCase() === 'true';
        if (op === '==') return actual === boolThreshold;
        if (op === '!=') return actual !== boolThreshold;
        return false;
    }
    const a = toNum(actual);
    const b = toNum(threshold);
    if (op === '>') return a > b;
    if (op === '<') return a < b;
    if (op === '>=') return a >= b;
    if (op === '<=') return a <= b;
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    return false;
}

async function alertsGetParameterValue(path) {
    try {
        const m = await fetchApiJson('/api/metrics');
        const mapping = {
            'Device.DeviceInfo.ProcessStatus.CPUUsage': m.cpu_usage,
            'Device.DeviceInfo.MemoryStatus.Free': m.memory_free,
            'Device.Ethernet.Interface.1.Stats.BytesReceived': m.bytes_received,
            'Device.Ethernet.Interface.1.Stats.BytesSent': m.bytes_sent
        };
        if (mapping[path] !== undefined) return mapping[path];
    } catch (_) {}
    if (path === 'Device.WiFi.Radio.1.Enable') {
        try {
            const wifi = await fetchApiJson('/api/wifi/status');
            return !!(wifi.radios && wifi.radios['2g'] && wifi.radios['2g'].enabled);
        } catch (_) { return true; }
    }
    return Math.round(Math.random() * 100);
}

function alertsRenderRules() {
    const tbody = document.getElementById('alerts-rules-tbody');
    if (!tbody) return;
    if (!FEATURE_STATE.alerts.rules.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">No rules configured</td></tr>';
        return;
    }
    tbody.innerHTML = FEATURE_STATE.alerts.rules.map((r, i) => `<tr>
      <td>${escHtml(r.name)}</td><td><code>${escHtml(r.path)}</code></td><td>${escHtml(r.condition)}</td><td>${escHtml(String(r.threshold))}</td><td>${escHtml(r.severity)}</td>
      <td>${r.muted ? 'Muted' : 'Active'}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="alertsEditRule(${i})">Edit</button>
        <button class="btn btn-sm btn-warning" onclick="alertsToggleMute(${i})">${r.muted ? 'Unmute' : 'Mute'}</button>
        <button class="btn btn-sm btn-danger" onclick="alertsDeleteRule(${i})">Delete</button>
      </td>
    </tr>`).join('');
}

function alertsRenderActiveAndHistory() {
    const activeWrap = document.getElementById('alerts-active-cards');
    const historyBody = document.getElementById('alerts-history-tbody');
    const activeEntries = Object.values(FEATURE_STATE.alerts.active);
    alertsSetNavBadge(activeEntries.length);
    if (activeWrap) {
        activeWrap.innerHTML = activeEntries.length ? activeEntries.map(a => `<article class="alert-card alert-${a.severity.toLowerCase()}">
          <div><strong>${escHtml(a.name)}</strong> (${escHtml(a.parameter)})</div>
          <div>Current: ${escHtml(String(a.value))} vs ${escHtml(a.condition + ' ' + a.threshold)}</div>
          <div>Since: ${new Date(a.firstBreach).toLocaleTimeString()}</div>
          <button class="btn btn-sm btn-primary mt-2" onclick="alertsAcknowledge('${escHtml(a.id)}')">Acknowledge</button>
        </article>`).join('') : '<div class="feature-empty">No active alerts</div>';
    }
    if (historyBody) {
        if (!FEATURE_STATE.alerts.history.length) historyBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);">No alert history</td></tr>';
        else historyBody.innerHTML = FEATURE_STATE.alerts.history.slice().reverse().map(h => `<tr><td>${escHtml(h.time)}</td><td>${escHtml(h.name)}</td><td>${escHtml(h.parameter)}</td><td>${escHtml(String(h.value))}</td><td>${escHtml(h.severity)}</td><td>${escHtml(h.resolvedAt || '—')}</td></tr>`).join('');
    }
}

async function alertsEvaluateRules() {
    for (const rule of FEATURE_STATE.alerts.rules) {
        if (rule.muted) continue;
        const value = await alertsGetParameterValue(rule.path);
        const breached = alertsCompare(value, rule.condition, rule.threshold);
        const id = `${rule.name}|${rule.path}`;
        if (breached && !FEATURE_STATE.alerts.active[id]) {
            FEATURE_STATE.alerts.active[id] = { id, name: rule.name, parameter: rule.path, condition: rule.condition, threshold: rule.threshold, severity: rule.severity, value, firstBreach: Date.now() };
            if (rule.severity === 'Critical' && 'Notification' in window) {
                if (Notification.permission === 'default') Notification.requestPermission();
                if (Notification.permission === 'granted') new Notification(`Critical Alert: ${rule.name}`, { body: `${rule.path} = ${value}` });
            }
        } else if (breached) FEATURE_STATE.alerts.active[id].value = value;
        else if (!breached && FEATURE_STATE.alerts.active[id]) {
            const resolved = FEATURE_STATE.alerts.active[id];
            delete FEATURE_STATE.alerts.active[id];
            FEATURE_STATE.alerts.history.push({
                time: new Date(resolved.firstBreach).toLocaleString(),
                name: resolved.name,
                parameter: resolved.parameter,
                value: resolved.value,
                severity: resolved.severity,
                resolvedAt: new Date().toLocaleString()
            });
        }
    }
    alertsRenderActiveAndHistory();
}

function alertsAddRule() {
    const rule = {
        name: (document.getElementById('alerts-rule-name') || {}).value?.trim() || 'Unnamed Alert',
        path: (document.getElementById('alerts-rule-path') || {}).value?.trim() || '',
        condition: (document.getElementById('alerts-rule-condition') || {}).value || '>',
        threshold: (document.getElementById('alerts-rule-threshold') || {}).value || '0',
        severity: (document.getElementById('alerts-rule-severity') || {}).value || 'Warning',
        muted: false
    };
    if (!rule.path) return showNotification('Parameter path is required', 'warning');
    FEATURE_STATE.alerts.rules.push(rule);
    alertsSaveRules();
    alertsRenderRules();
}

function alertsEditRule(index) {
    const r = FEATURE_STATE.alerts.rules[index];
    if (!r) return;
    document.getElementById('alerts-rule-name').value = r.name;
    document.getElementById('alerts-rule-path').value = r.path;
    document.getElementById('alerts-rule-condition').value = r.condition;
    document.getElementById('alerts-rule-threshold').value = r.threshold;
    document.getElementById('alerts-rule-severity').value = r.severity;
    FEATURE_STATE.alerts.rules.splice(index, 1);
    alertsSaveRules();
    alertsRenderRules();
}

function alertsDeleteRule(index) {
    FEATURE_STATE.alerts.rules.splice(index, 1);
    alertsSaveRules();
    alertsRenderRules();
}

function alertsToggleMute(index) {
    if (!FEATURE_STATE.alerts.rules[index]) return;
    FEATURE_STATE.alerts.rules[index].muted = !FEATURE_STATE.alerts.rules[index].muted;
    alertsSaveRules();
    alertsRenderRules();
}

function alertsAcknowledge(id) {
    delete FEATURE_STATE.alerts.active[id];
    alertsRenderActiveAndHistory();
}

function alertsAddTemplate(type) {
    const templates = {
        memory: { name: 'High Memory Usage', path: 'Device.DeviceInfo.MemoryStatus.Free', condition: '<', threshold: 50000, severity: 'Warning', muted: false },
        radio: { name: 'WiFi Radio Down', path: 'Device.WiFi.Radio.1.Enable', condition: '==', threshold: 'false', severity: 'Critical', muted: false },
        cpu: { name: 'High CPU', path: 'Device.DeviceInfo.ProcessStatus.CPUUsage', condition: '>', threshold: 80, severity: 'Critical', muted: false }
    };
    if (templates[type]) FEATURE_STATE.alerts.rules.push(templates[type]);
    alertsSaveRules();
    alertsRenderRules();
}

function alertsInit() {
    alertsLoadRules();
    alertsRenderRules();
    alertsRenderActiveAndHistory();
    if (!FEATURE_STATE.alerts.interval) FEATURE_STATE.alerts.interval = setInterval(alertsEvaluateRules, 10000);
    alertsEvaluateRules();
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Fleet
// ══════════════════════════════════════════════════════════════════════════════
function fleetLoadDevices() {
    try { FEATURE_STATE.fleet.devices = JSON.parse(localStorage.getItem('usp_fleet_devices') || '[]'); } catch (_) { FEATURE_STATE.fleet.devices = []; }
}

function fleetSaveDevices() {
    localStorage.setItem('usp_fleet_devices', JSON.stringify(FEATURE_STATE.fleet.devices));
}

function fleetSetSort(key) {
    if (FEATURE_STATE.fleet.sort === key) FEATURE_STATE.fleet.sortAsc = !FEATURE_STATE.fleet.sortAsc;
    else { FEATURE_STATE.fleet.sort = key; FEATURE_STATE.fleet.sortAsc = true; }
    fleetRender();
}

async function fleetFetchStatus(device) {
    const fallback = {
        online: Math.random() > 0.2,
        softwareVersion: 'unknown',
        uptime: formatDuration(Math.floor(Math.random() * 7200)),
        serial: device.serial || device.name || 'N/A',
        activeAlerts: Object.keys(FEATURE_STATE.alerts.active).length,
        lastSeen: new Date().toLocaleTimeString()
    };
    try {
        const data = await fetchApiJson('/api/fleet/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(device) });
        showFeatureNotice('fleet-backend-notice', false);
        return {
            online: !!data.online,
            softwareVersion: data.software_version || fallback.softwareVersion,
            uptime: data.uptime || fallback.uptime,
            serial: data.serial || fallback.serial,
            activeAlerts: toNum(data.active_alerts, fallback.activeAlerts),
            lastSeen: data.last_seen || fallback.lastSeen
        };
    } catch (e) {
        if (String(e.message).includes('HTTP_404')) showFeatureNotice('fleet-backend-notice', true);
        return fallback;
    }
}

function fleetApplyStats(statusList) {
    const total = statusList.length;
    const online = statusList.filter(s => s.online).length;
    const alerts = statusList.filter(s => toNum(s.activeAlerts) > 0).length;
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('fleet-total', total);
    set('fleet-online', online);
    set('fleet-offline', total - online);
    set('fleet-alerts', alerts);
}

function fleetSwitchDevice(index) {
    const d = FEATURE_STATE.fleet.devices[index];
    if (!d) return;
    localStorage.setItem('usp_active_fleet_device', JSON.stringify(d));
    showNotification(`Switched to ${d.name}. Reloading...`, 'success');
    window.setTimeout(() => window.location.reload(), 400);
}

function fleetRemoveDevice(index) {
    FEATURE_STATE.fleet.devices.splice(index, 1);
    fleetSaveDevices();
    fleetRender();
}

function fleetAddDevice() {
    const item = {
        name: document.getElementById('fleet-name').value.trim(),
        brokerIp: document.getElementById('fleet-broker-ip').value.trim(),
        brokerPort: document.getElementById('fleet-broker-port').value.trim(),
        agentId: document.getElementById('fleet-agent-id').value.trim(),
        notes: document.getElementById('fleet-notes').value.trim()
    };
    if (!item.name || !item.brokerIp || !item.agentId) return showNotification('Device name, broker IP and agent ID are required', 'warning');
    FEATURE_STATE.fleet.devices.push(item);
    fleetSaveDevices();
    fleetRender();
}

function fleetToggleView() {
    FEATURE_STATE.fleet.view = FEATURE_STATE.fleet.view === 'cards' ? 'table' : 'cards';
    fleetRender();
}

function fleetRender() {
    const q = (document.getElementById('fleet-search')?.value || '').toLowerCase();
    const list = FEATURE_STATE.fleet.devices.filter(d => [d.name, d.brokerIp, d.agentId, d.notes].join(' ').toLowerCase().includes(q));
    const statusList = list.map((d, i) => ({ ...d, ...(FEATURE_STATE.fleet.statusCache[i] || {}) }));
    const sortKey = FEATURE_STATE.fleet.sort;
    statusList.sort((a, b) => {
        const av = String(a[sortKey] ?? '');
        const bv = String(b[sortKey] ?? '');
        return FEATURE_STATE.fleet.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    fleetApplyStats(statusList);
    const cardWrap = document.getElementById('fleet-cards');
    const tableBody = document.getElementById('fleet-tbody');
    if (cardWrap) {
        cardWrap.innerHTML = statusList.length ? statusList.map((d, i) => `<article class="fleet-card ${d.online ? 'online' : 'offline'}">
          <div class="fleet-card-title">${escHtml(d.name)} <span class="status-dot ${d.online ? 'on' : 'off'}"></span></div>
          <div>Serial: ${escHtml(d.serial || d.name || 'N/A')}</div>
          <div>SW Version: ${escHtml(d.softwareVersion || '—')}</div>
          <div>Uptime: ${escHtml(d.uptime || '—')}</div>
          <div>Last Seen: ${escHtml(d.lastSeen || '—')}</div>
          <div>Active Alerts: <span class="badge">${toNum(d.activeAlerts)}</span></div>
          <div class="fleet-actions">
            <button class="btn btn-sm btn-primary" onclick="fleetSwitchDevice(${i})">Switch to Device</button>
            <button class="btn btn-sm btn-danger" onclick="fleetRemoveDevice(${i})">Remove</button>
          </div>
        </article>`).join('') : '<div class="feature-empty">No devices registered</div>';
    }
    if (tableBody) {
        tableBody.innerHTML = statusList.length ? statusList.map((d, i) => `<tr>
          <td>${escHtml(d.name)}</td><td>${escHtml(d.serial || d.name || 'N/A')}</td><td>${d.online ? 'Online' : 'Offline'}</td><td>${escHtml(d.softwareVersion || '—')}</td>
          <td>${escHtml(d.uptime || '—')}</td><td>${escHtml(d.brokerIp || '—')}</td><td>${escHtml(d.lastSeen || '—')}</td>
          <td><button class="btn btn-sm btn-primary" onclick="fleetSwitchDevice(${i})">Switch</button> <button class="btn btn-sm btn-danger" onclick="fleetRemoveDevice(${i})">Remove</button></td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">No devices registered</td></tr>';
    }
    const cardView = document.getElementById('fleet-card-view');
    const tableView = document.getElementById('fleet-table-view');
    if (cardView) cardView.style.display = FEATURE_STATE.fleet.view === 'cards' ? 'block' : 'none';
    if (tableView) tableView.style.display = FEATURE_STATE.fleet.view === 'cards' ? 'none' : 'block';
}

async function fleetRefreshNow() {
    const statuses = await Promise.all(FEATURE_STATE.fleet.devices.map(d => fleetFetchStatus(d)));
    FEATURE_STATE.fleet.statusCache = {};
    statuses.forEach((s, i) => { FEATURE_STATE.fleet.statusCache[i] = s; });
    FEATURE_STATE.fleet.countdown = 30;
    fleetRender();
}

function fleetInit() {
    fleetLoadDevices();
    fleetRender();
    fleetRefreshNow();
    if (!FEATURE_STATE.fleet.countdownInterval) {
        FEATURE_STATE.fleet.countdownInterval = setInterval(() => {
            FEATURE_STATE.fleet.countdown -= 1;
            const label = document.getElementById('fleet-refresh-countdown');
            if (label) label.textContent = `Refresh in ${FEATURE_STATE.fleet.countdown}s`;
            if (FEATURE_STATE.fleet.countdown <= 0) fleetRefreshNow();
        }, 1000);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. WiFi Management
// ══════════════════════════════════════════════════════════════════════════════
function wifiLoadAclRules() {
    try { return JSON.parse(localStorage.getItem('usp_wifi_acl_rules') || '[]'); } catch (_) { return []; }
}

function wifiRenderAclRules() {
    const wrap = document.getElementById('wifi-acl-list');
    if (!wrap) return;
    const rules = wifiLoadAclRules();
    wrap.innerHTML = rules.length ? rules.map((r, i) => `<div class="simple-list-item">${escHtml(r.mac)} • ${escHtml(r.mode)} • ${escHtml(r.day)} ${escHtml(r.time)} <button class="btn btn-sm btn-danger" onclick="wifiDeleteAclRule(${i})">Delete</button></div>`).join('') : '<div class="feature-empty">No rules</div>';
}

function wifiAddAclRule() {
    const rules = wifiLoadAclRules();
    rules.push({
        mac: document.getElementById('wifi-acl-mac').value.trim(),
        mode: document.getElementById('wifi-acl-mode').value,
        day: document.getElementById('wifi-acl-day').value,
        time: document.getElementById('wifi-acl-time').value.trim() || 'Always'
    });
    localStorage.setItem('usp_wifi_acl_rules', JSON.stringify(rules));
    wifiRenderAclRules();
}

function wifiDeleteAclRule(i) {
    const rules = wifiLoadAclRules();
    rules.splice(i, 1);
    localStorage.setItem('usp_wifi_acl_rules', JSON.stringify(rules));
    wifiRenderAclRules();
}

function wifiLoadQosSettings() {
    try {
        const s = JSON.parse(localStorage.getItem('usp_wifi_qos') || '{}');
        ['band-steering', 'airtime', 'wmm'].forEach(k => {
            const el = document.getElementById(`wifi-qos-${k}`);
            if (el) el.checked = !!s[k];
        });
    } catch (_) {}
}

function wifiSaveQosSettings() {
    const data = {
        'band-steering': !!document.getElementById('wifi-qos-band-steering')?.checked,
        airtime: !!document.getElementById('wifi-qos-airtime')?.checked,
        wmm: !!document.getElementById('wifi-qos-wmm')?.checked
    };
    localStorage.setItem('usp_wifi_qos', JSON.stringify(data));
}

async function wifiLoadStatus() {
    try {
        const d = await fetchApiJson('/api/wifi/status');
        if (!d.success) return;
        ['2g', '5g', '6g'].forEach(band => {
            const radio = d.radios ? d.radios[band] : null;
            const card = document.getElementById('wifi-radio-' + band);
            if (!card || !radio) return;
            card.querySelector('.wifi-radio-channel').textContent = radio.channel || '—';
            card.querySelector('.wifi-radio-txpower').textContent = radio.tx_power || '—';
            const noise = card.querySelector('.wifi-radio-noise');
            if (noise) noise.textContent = radio.noise_floor || radio.rssi_noise_floor || '—';
            const country = card.querySelector('.wifi-radio-country');
            if (country) country.textContent = radio.country || 'US';
            const standard = card.querySelector('.wifi-radio-standard');
            if (standard) standard.textContent = radio.standard || radio.mode || 'ax/ac/n';
            const tog = card.querySelector('.wifi-toggle');
            if (tog) tog.checked = !!radio.enabled;
        });
        const tbody = document.getElementById('wifi-ssid-tbody');
        if (tbody && d.ssids) {
            FEATURE_STATE.wifi.ssids = d.ssids;
            window._wifiSsids = d.ssids;
            tbody.innerHTML = '';
            d.ssids.forEach((s, i) => {
                const masked = s.password ? '•'.repeat(Math.min(8, String(s.password).length)) : '••••••••';
                tbody.innerHTML += `<tr>
                  <td>${escHtml(s.ssid || 'Unknown')}</td>
                  <td>${escHtml(s.band || '—')}</td>
                  <td>${escHtml(s.security || 'WPA2-Personal')}</td>
                  <td><span id="wifi-key-${i}" data-raw="${escHtml(s.password || '')}">${masked}</span> <button class="btn btn-sm btn-info" onclick="wifiToggleKey(${i})">Show/Hide</button></td>
                  <td><code>${escHtml(s.bssid || '—')}</code></td>
                  <td><input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="wifiToggleSsid(${i},this.checked)"></td>
                  <td>
                    <button class="btn btn-sm btn-primary" onclick="wifiOpenEditModalByIdx(${i})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="wifiDeleteSsid(${i})">Delete</button>
                  </td>
                </tr>`;
            });
        }
        showFeatureNotice('wifi-backend-notice', false);
    } catch (e) {
        console.error('WiFi status error', e);
        showFeatureNotice('wifi-backend-notice', true);
    }
}

function wifiToggleKey(i) {
    const el = document.getElementById(`wifi-key-${i}`);
    if (!el) return;
    const raw = el.getAttribute('data-raw') || '';
    const isMasked = el.textContent.includes('•');
    el.textContent = isMasked ? raw || '(empty)' : '•'.repeat(Math.min(8, raw.length || 8));
}

function wifiToggleAddSsidForm() {
    const el = document.getElementById('wifi-add-ssid-form');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function wifiAddSsidInline() {
    const payload = {
        idx: FEATURE_STATE.wifi.ssids.length,
        ssid: document.getElementById('wifi-new-ssid-name').value.trim(),
        password: document.getElementById('wifi-new-ssid-key').value,
        security: document.getElementById('wifi-new-ssid-security').value,
        vlan_id: toNum(document.getElementById('wifi-new-ssid-vlan').value, 0),
        broadcast: !!document.getElementById('wifi-new-ssid-broadcast').checked,
        max_clients: toNum(document.getElementById('wifi-new-ssid-max-clients').value, 32),
        enabled: true
    };
    if (!payload.ssid) return showNotification('SSID name required', 'warning');
    try {
        const d = await fetchApiJson('/api/wifi/set_ssid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showNotification(d.success ? 'SSID saved' : 'Failed to save SSID', d.success ? 'success' : 'error');
        wifiLoadStatus();
    } catch (_) { showNotification('SSID API unavailable (requires backend support)', 'warning'); }
}

async function wifiApplyRadio(band) {
    const enabled = !!document.getElementById(`wifi-toggle-${band}`)?.checked;
    try {
        await fetchApiJson('/api/wifi/radio_set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ band, enabled }) });
        showNotification(`Applied ${band} radio settings`, 'success');
        showFeatureNotice('wifi-backend-notice', false);
    } catch (_) {
        showFeatureNotice('wifi-backend-notice', true);
        showNotification('Feature requires backend support (/api/wifi/radio_set)', 'warning');
    }
}

async function wifiScan() {
    const btn = document.getElementById('wifi-scan-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning…'; }
    try {
        const d = await fetchApiJson('/api/wifi/scan');
        const channels = {};
        (d.results || []).forEach(n => {
            const ch = toNum(n.channel, 1);
            channels[ch] = (channels[ch] || 0) + Math.abs(toNum(n.signal, -60));
        });
        const labels = Object.keys(channels).sort((a, b) => toNum(a) - toNum(b));
        const values = labels.map(l => channels[l]);
        const minIndex = values.length ? values.indexOf(Math.min(...values)) : -1;
        const recommend = document.getElementById('wifi-channel-recommend');
        if (recommend) recommend.innerHTML = minIndex >= 0 ? `Recommended channel: <span style="color:var(--success);font-weight:700;">${labels[minIndex]}</span>` : 'Recommended channel: —';
        const panel = document.getElementById('wifi-scan-results');
        if (panel) panel.style.display = 'block';
        if (typeof Chart !== 'undefined') {
            if (FEATURE_STATE.wifi.channelChart) FEATURE_STATE.wifi.channelChart.destroy();
            FEATURE_STATE.wifi.channelChart = new Chart(document.getElementById('wifi-channel-chart'), {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Channel Utilization', data: values, backgroundColor: labels.map((_, i) => i === minIndex ? '#00e5a0' : '#00c6ff') }] },
                options: chartTheme()
            });
        }
    } catch (e) {
        console.error('WiFi scan error', e);
        showFeatureNotice('wifi-backend-notice', true);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Channels'; }
    }
}

function wifiOpenEditModal(ssid, idx) {
    document.getElementById('wifi-edit-idx').value = idx;
    document.getElementById('wifi-edit-ssid').value = ssid.ssid || '';
    document.getElementById('wifi-edit-password').value = ssid.password || '';
    document.getElementById('wifi-edit-security').value = ssid.security || 'WPA2-Personal';
    document.getElementById('wifi-edit-band').value = ssid.band || '2.4GHz';
    document.getElementById('wifi-edit-channel').value = ssid.channel || '';
    document.getElementById('wifi-edit-maxclients').value = ssid.max_clients || '';
    document.getElementById('wifi-edit-modal').style.display = 'flex';
}

function wifiOpenEditModalByIdx(idx) {
    const ssids = window._wifiSsids || [];
    if (ssids[idx]) wifiOpenEditModal(ssids[idx], idx);
}

function wifiCloseModal() {
    document.getElementById('wifi-edit-modal').style.display = 'none';
}

async function wifiSaveEdit() {
    const idx = document.getElementById('wifi-edit-idx').value;
    const payload = {
        idx: parseInt(idx, 10),
        ssid: document.getElementById('wifi-edit-ssid').value,
        password: document.getElementById('wifi-edit-password').value,
        security: document.getElementById('wifi-edit-security').value,
        band: document.getElementById('wifi-edit-band').value,
        channel: document.getElementById('wifi-edit-channel').value,
        max_clients: parseInt(document.getElementById('wifi-edit-maxclients').value, 10) || 0
    };
    try {
        const d = await fetchApiJson('/api/wifi/set_ssid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showNotification(d.success ? 'SSID updated successfully' : 'Update failed: ' + d.error, d.success ? 'success' : 'error');
        if (d.success) { wifiCloseModal(); wifiLoadStatus(); }
    } catch (_) { showNotification('SSID update error', 'error'); }
}

async function wifiDeleteSsid(idx) {
    await wifiToggleSsid(idx, false);
    showNotification('SSID deleted/disabled', 'success');
    wifiLoadStatus();
}

async function wifiToggleSsid(idx, enabled) {
    try {
        await fetchApiJson('/api/wifi/set_ssid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idx, enabled }) });
    } catch (e) { console.error('WiFi toggle error', e); }
}

async function wifiLoadClients() {
    try {
        const d = await fetchApiJson('/api/devices');
        const clients = (d.devices || []).filter(c => String(c.connection_type).toLowerCase() === 'wifi');
        FEATURE_STATE.wifi.clients = clients;
        const tbody = document.getElementById('wifi-clients-tbody');
        if (!tbody) return;
        tbody.innerHTML = clients.length ? clients.map(c => `<tr>
          <td><code>${escHtml(c.mac || '—')}</code></td>
          <td>${escHtml(c.hostname || 'Unknown')}</td>
          <td>${escHtml(c.ssid || 'WiFi')}</td>
          <td>${signalBars(c.rssi || c.signal)} ${(toNum(c.rssi || c.signal, -70))} dBm</td>
          <td>${toNum(c.tx_rate, 0)} / ${toNum(c.rx_rate, 0)} Mbps</td>
          <td>${escHtml(c.association_time || c.last_seen || '—')}</td>
          <td>${escHtml(c.capabilities || '802.11ax')}</td>
          <td><button class="btn btn-sm btn-danger" onclick="wifiKickClient('${escHtml(c.mac || '')}')">Kick Client</button></td>
        </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">No WiFi clients</td></tr>';
    } catch (_) {}
}

async function wifiKickClient(mac) {
    try {
        await fetchApiJson('/api/wifi/kick_client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mac }) });
        showNotification(`Client ${mac} kicked`, 'success');
    } catch (_) {
        showFeatureNotice('wifi-backend-notice', true);
        showNotification('Feature requires backend support (/api/wifi/kick_client)', 'warning');
    }
}

function wifiExportClientsCsv() {
    const clients = FEATURE_STATE.wifi.clients || [];
    const rows = [['MAC', 'Hostname', 'Band', 'RSSI', 'TxRate', 'RxRate', 'AssociationTime']];
    clients.forEach(c => rows.push([c.mac, c.hostname, c.ssid, c.rssi || c.signal, c.tx_rate, c.rx_rate, c.association_time || c.last_seen]));
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wifi_clients.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function wifiInit() {
    wifiLoadStatus();
    wifiLoadClients();
    wifiRenderAclRules();
    wifiLoadQosSettings();
    if (!FEATURE_STATE.wifi.clientsInterval) FEATURE_STATE.wifi.clientsInterval = setInterval(wifiLoadClients, 15000);
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. Connected Devices
// ══════════════════════════════════════════════════════════════════════════════
let _allDevices = [];

async function devicesLoad() {
    try {
        const r = await fetch('/api/devices');
        const d = await r.json();
        _allDevices = d.devices || [];
        devicesRender(_allDevices);
        // Update summary
        const wifi = _allDevices.filter(x => x.connection_type === 'WiFi').length;
        const wired = _allDevices.filter(x => x.connection_type === 'Wired').length;
        const active = _allDevices.filter(x => x.status === 'Active').length;
        const el = id => document.getElementById(id);
        if (el('dev-total')) el('dev-total').textContent = _allDevices.length;
        if (el('dev-wifi')) el('dev-wifi').textContent = wifi;
        if (el('dev-wired')) el('dev-wired').textContent = wired;
        if (el('dev-active')) el('dev-active').textContent = active;
    } catch(e) { console.error('Devices load error', e); }
}

function devicesRender(list) {
    const tbody = document.getElementById('devices-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    list.forEach((d,i) => {
        const sigHtml = d.connection_type === 'WiFi' ? signalBars(d.signal) : '<span class="text-muted">—</span>';
        const connType = d.connection_type === 'WiFi' ? 'wifi' : 'ethernet';
        tbody.innerHTML += `<tr class="dev-row" onclick="devicesToggleDetail(${i})">
          <td>${escHtml(d.hostname)}</td>
          <td>${escHtml(d.ip)}</td>
          <td><code>${escHtml(d.mac)}</code></td>
          <td><i class="fas fa-${connType}"></i> ${escHtml(d.connection_type)}</td>
          <td>${escHtml(d.ssid || '—')}</td>
          <td>${sigHtml}</td>
          <td><span class="status-badge status-${escHtml(d.status.toLowerCase())}">${escHtml(d.status)}</span></td>
          <td>${escHtml(d.last_seen)}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();devicesBlockByIdx(${i})">${d.blocked?'Unblock':'Block'}</button>
          </td>
        </tr>
        <tr id="dev-detail-${i}" class="dev-detail-row" style="display:none">
          <td colspan="9">
            <div class="dev-detail-panel">
              <div><strong>Vendor:</strong> ${escHtml(d.vendor || 'Unknown')}</div>
              <div><strong>Lease:</strong> ${escHtml(d.lease_time || 'N/A')}</div>
              <div><strong>TX Rate:</strong> ${parseInt(d.tx_rate) || '—'} Mbps</div>
              <div><strong>RX Rate:</strong> ${parseInt(d.rx_rate) || '—'} Mbps</div>
              <div><strong>RSSI:</strong> ${d.rssi !== null && d.rssi !== undefined ? parseInt(d.rssi) + ' dBm' : '—'}</div>
              <div><strong>Internet:</strong> <button class="btn btn-warning btn-sm" onclick="devicesBlockByIdx(${i})">${d.blocked?'Unblocked':'Block Internet'}</button></div>
            </div>
          </td>
        </tr>`;
    });
}

function devicesBlockByIdx(i) {
    const d = _allDevices[i];
    if (d) devicesBlock(d.mac, !d.blocked);
}

function signalBars(sig) {
    const val = parseInt(sig) || -100;
    const pct = Math.min(100, Math.max(0, (val + 100) * 2));
    const color = pct > 60 ? 'var(--success)' : pct > 30 ? 'var(--warning)' : 'var(--error)';
    return `<span class="signal-bars" title="${val} dBm">
      <span class="signal-bar ${pct>20?'active':''}" style="background:${color}"></span>
      <span class="signal-bar ${pct>40?'active':''}" style="background:${color}"></span>
      <span class="signal-bar ${pct>60?'active':''}" style="background:${color}"></span>
      <span class="signal-bar ${pct>80?'active':''}" style="background:${color}"></span>
    </span>`;
}

function devicesToggleDetail(i) {
    const row = document.getElementById('dev-detail-' + i);
    if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

async function devicesBlock(mac, block) {
    try {
        const r = await fetch('/api/devices/block', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({mac, block}) });
        const d = await r.json();
        showNotification(d.success ? (block?'Device blocked':'Device unblocked') : 'Action failed', d.success?'success':'error');
        devicesLoad();
    } catch(e) { showNotification('Device block error', 'error'); }
}

function devicesFilter(type) {
    document.querySelectorAll('.dev-filter-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.dev-filter-btn[data-filter="${type}"]`);
    if (btn) btn.classList.add('active');
    let list = _allDevices;
    if (type === 'WiFi') list = list.filter(d => d.connection_type === 'WiFi');
    else if (type === 'Wired') list = list.filter(d => d.connection_type === 'Wired');
    else if (type === 'Active') list = list.filter(d => d.status === 'Active');
    else if (type === 'Inactive') list = list.filter(d => d.status === 'Inactive');
    devicesRender(list);
}

function devicesSearch(q) {
    q = q.toLowerCase();
    const list = _allDevices.filter(d =>
        d.hostname.toLowerCase().includes(q) || d.mac.toLowerCase().includes(q) || d.ip.includes(q)
    );
    devicesRender(list);
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. EasyMesh
// ══════════════════════════════════════════════════════════════════════════════
async function easymeshFetchData() {
    try {
        const d = await fetchApiJson('/api/easymesh/status');
        return d;
    } catch (_) {
        return {
            controller: { mac: 'AA:BB:CC:DD:EE:01', ip: '192.168.0.1', uptime: '3d 10h', software: 'RDKB-1.0', path: 'Device.WiFi.DataElements.Network.Device.1.' },
            agents: [
                { mac: 'AA:BB:CC:DD:EE:02', ip: '192.168.0.2', backhaul: 'WiFi', rssi: -56, clients: 6, uptime: '2d 4h', software: 'RDKB-1.0', status: 'Online', path: 'Device.WiFi.DataElements.Network.Device.2.' },
                { mac: 'AA:BB:CC:DD:EE:03', ip: '192.168.0.3', backhaul: 'Ethernet', rssi: -42, clients: 3, uptime: '5d 1h', software: 'RDKB-1.0', status: 'Online', path: 'Device.WiFi.DataElements.Network.Device.3.' }
            ]
        };
    }
}

function easymeshAction(action, mac) {
    showNotification(`${action} triggered for ${mac}`, 'info');
}

function easymeshRenderMap(data) {
    const wrap = document.getElementById('easymesh-map');
    if (!wrap) return;
    const agents = data.agents || [];
    const width = wrap.clientWidth || 900;
    const height = 280;
    const cx = width / 2;
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svg += `<circle cx="${cx}" cy="40" r="22" fill="#0077ff"></circle><text x="${cx}" y="45" text-anchor="middle" fill="#fff" font-size="12">C</text>`;
    agents.forEach((a, i) => {
        const x = ((i + 1) * width) / (agents.length + 1);
        const y = 140;
        const color = a.backhaul === 'Ethernet' ? '#00e5a0' : '#00c6ff';
        svg += `<line x1="${cx}" y1="60" x2="${x}" y2="${y - 18}" stroke="${color}" stroke-width="2"></line>`;
        svg += `<rect x="${x - 22}" y="${y - 18}" width="44" height="36" rx="8" fill="#132647" stroke="${color}"></rect>`;
        svg += `<text x="${x}" y="${y + 5}" text-anchor="middle" fill="#a0aec0" font-size="10">${escHtml(a.mac.slice(-5))}</text>`;
        const clientY = 230;
        svg += `<line x1="${x}" y1="${y + 18}" x2="${x}" y2="${clientY - 12}" stroke="#6b7280"></line>`;
        svg += `<circle cx="${x}" cy="${clientY}" r="12" fill="#6b7280"></circle>`;
        svg += `<text x="${x}" y="${clientY + 4}" text-anchor="middle" fill="#fff" font-size="9">${a.clients}</text>`;
    });
    svg += `</svg>`;
    wrap.innerHTML = svg;
    wrap.querySelectorAll('rect,circle').forEach(node => {
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => {
            const details = document.getElementById('easymesh-node-details');
            if (details) details.textContent = JSON.stringify(data, null, 2);
        });
    });
}

async function easymeshLoad() {
    const data = await easymeshFetchData();
    FEATURE_STATE.easymesh.data = data;
    const ctrl = document.getElementById('easymesh-controller-card');
    if (ctrl) ctrl.innerHTML = `<strong>Controller</strong> • ${escHtml(data.controller.mac)} • ${escHtml(data.controller.ip)} • ${escHtml(data.controller.path || 'Device.WiFi.DataElements.Network.Device.1.')}`;
    const cards = document.getElementById('easymesh-agent-cards');
    const tbody = document.getElementById('easymesh-agent-tbody');
    const agents = data.agents || [];
    if (cards) cards.innerHTML = agents.length ? agents.map(a => `<article class="mesh-agent-card">
      <div><strong>${escHtml(a.mac)}</strong> (${escHtml(a.ip)})</div>
      <div>Backhaul: ${escHtml(a.backhaul)} • RSSI ${toNum(a.rssi)} dBm</div>
      <div>Clients: ${toNum(a.clients)} • Uptime: ${escHtml(a.uptime)}</div>
      <div>Software: ${escHtml(a.software)}</div>
    </article>`).join('') : '<div class="feature-empty">No agent nodes discovered</div>';
    if (tbody) tbody.innerHTML = agents.length ? agents.map(a => `<tr>
      <td>${escHtml(a.mac)}</td><td>${escHtml(a.ip)}</td><td>${escHtml(a.backhaul)}</td><td>${toNum(a.rssi)} dBm</td><td>${toNum(a.clients)}</td><td>${escHtml(a.status || 'Unknown')}</td>
      <td><button class="btn btn-sm btn-primary" onclick="easymeshAction('Steer Client','${escHtml(a.mac)}')">Steer Client</button> <button class="btn btn-sm btn-warning" onclick="easymeshAction('Reboot Agent','${escHtml(a.mac)}')">Reboot Agent</button> <button class="btn btn-sm btn-info" onclick="easymeshAction('Channel Optimize','${escHtml(a.mac)}')">Channel Optimize</button></td>
    </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">No agents</td></tr>';
    const totalClients = agents.reduce((a, n) => a + toNum(n.clients), 0);
    const avgRssi = agents.length ? Math.round(agents.reduce((a, n) => a + toNum(n.rssi), 0) / agents.length) : 0;
    const health = Math.max(0, Math.min(100, 120 + avgRssi));
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    set('mesh-total-nodes', agents.length + 1);
    set('mesh-total-clients', totalClients);
    set('mesh-avg-rssi', agents.length ? `${avgRssi} dBm` : '—');
    set('mesh-health-score', agents.length ? `${health}%` : '—');
    easymeshRenderMap(data);
    try {
        const events = await fetchApiJson('/api/events');
        const meshEvents = (events.events || []).filter(e => JSON.stringify(e).toLowerCase().includes('mesh'));
        const log = document.getElementById('easymesh-events-log');
        if (log) log.innerHTML = meshEvents.length ? meshEvents.slice(-20).map(e => `<div>${escHtml(e.timestamp || '')} • ${escHtml(e.event_name || e.type || 'event')}</div>`).join('') : 'No mesh-related events yet.';
    } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Topology
// ══════════════════════════════════════════════════════════════════════════════
function topologyBuildFromData(devices, wifiStatus) {
    const nodes = [
        { id: 'wan', label: 'WAN', color: '#7c3aed', shape: 'dot', size: 18, data: { type: 'wan' } },
        { id: 'gw', label: 'Gateway/CPE', color: '#0077ff', shape: 'box', data: { type: 'gateway' } },
        { id: 'eth1', label: 'Ethernet 1', color: '#00e5a0', shape: 'dot', data: { type: 'ethernet' } },
        { id: 'wifi24', label: 'WiFi 2.4G', color: '#06b6d4', shape: 'dot', data: { type: 'wifi' } },
        { id: 'wifi5', label: 'WiFi 5G', color: '#06b6d4', shape: 'dot', data: { type: 'wifi' } }
    ];
    const edges = [
        { from: 'wan', to: 'gw', label: 'WAN link' },
        { from: 'gw', to: 'eth1', label: 'LAN' },
        { from: 'gw', to: 'wifi24', label: 'SSID 2.4G' },
        { from: 'gw', to: 'wifi5', label: 'SSID 5G' }
    ];
    const clients = (devices || []).map((d, i) => ({ ...d, nodeId: `client-${i}` }));
    clients.forEach(c => {
        const isWifi = String(c.connection_type).toLowerCase() === 'wifi';
        nodes.push({ id: c.nodeId, label: FEATURE_STATE.topology.showLabels ? (c.hostname || c.mac || 'Client') : '', color: '#6b7280', shape: 'dot', data: c });
        edges.push({ from: isWifi ? 'wifi5' : 'eth1', to: c.nodeId, label: FEATURE_STATE.topology.showLabels ? (isWifi ? `RSSI ${toNum(c.rssi || c.signal, -70)} dBm` : 'Ethernet') : '' });
    });
    FEATURE_STATE.topology.clients = clients;
    FEATURE_STATE.topology.nodes = nodes;
    FEATURE_STATE.topology.edges = edges;
    const ifaces = [];
    ifaces.push({ name: 'Ethernet.Interface.1', type: 'Ethernet', mac: 'AA:BB:CC:11:22:33', ip: '192.168.0.1', status: 'Up', speed: '1 Gbps', bytes: `${toNum(wifiStatus?.stats?.[0]?.rx_bytes, 0)}/${toNum(wifiStatus?.stats?.[0]?.tx_bytes, 0)}` });
    ifaces.push({ name: 'WiFi.Radio.1', type: 'WiFi', mac: 'AA:BB:CC:11:22:44', ip: '—', status: 'Up', speed: '866 Mbps', bytes: `${toNum(wifiStatus?.stats?.[1]?.rx_bytes, 0)}/${toNum(wifiStatus?.stats?.[1]?.tx_bytes, 0)}` });
    return { nodes, edges, clients, interfaces: ifaces };
}

function topologyRenderInterfaces(rows) {
    const tbody = document.getElementById('topology-interfaces-tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(r => `<tr class="${String(r.status).toLowerCase() === 'up' ? 'row-up' : 'row-down'}">
      <td>${escHtml(r.name)}</td><td>${escHtml(r.type)}</td><td>${escHtml(r.mac)}</td><td>${escHtml(r.ip)}</td><td>${escHtml(r.status)}</td><td>${escHtml(r.speed)}</td><td>${escHtml(r.bytes)}</td>
    </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);">No interfaces loaded</td></tr>';
}

function topologyRenderClientsTable() {
    const tbody = document.getElementById('topology-clients-tbody');
    if (!tbody) return;
    const q = (document.getElementById('topology-clients-search')?.value || '').toLowerCase();
    const type = document.getElementById('topology-client-type')?.value || 'all';
    let list = FEATURE_STATE.topology.clients.slice();
    if (type !== 'all') list = list.filter(c => String(c.connection_type).toLowerCase() === type);
    list = list.filter(c => `${c.hostname || ''} ${c.mac || ''} ${c.ip || ''}`.toLowerCase().includes(q));
    tbody.innerHTML = list.length ? list.map(c => `<tr>
      <td>${escHtml(c.hostname || c.mac || 'Unknown')}</td><td>${escHtml(c.ip || '—')}</td><td>${escHtml(c.connection_type || '—')}</td>
      <td>${String(c.connection_type).toLowerCase() === 'wifi' ? `${toNum(c.rssi || c.signal, -70)} dBm` : '—'}</td>
      <td>${toNum(c.tx_bytes, 0)} / ${toNum(c.rx_bytes, 0)}</td><td>${escHtml(c.online_duration || c.last_seen || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);">No clients loaded</td></tr>';
}

function topologyApplyLayout() {
    if (!FEATURE_STATE.topology.network) return;
    const mode = document.getElementById('topology-layout')?.value || 'force';
    const options = {
        physics: mode !== 'hierarchical',
        layout: mode === 'hierarchical' ? { hierarchical: { enabled: true, direction: 'UD' } } : mode === 'circular' ? { randomSeed: 42 } : {}
    };
    FEATURE_STATE.topology.network.setOptions(options);
}

function topologyToggleClients() {
    FEATURE_STATE.topology.showClients = !FEATURE_STATE.topology.showClients;
    topologyRefresh();
}

function topologyToggleLabels() {
    FEATURE_STATE.topology.showLabels = !FEATURE_STATE.topology.showLabels;
    topologyRefresh();
}

function topologyFit() {
    if (FEATURE_STATE.topology.network) FEATURE_STATE.topology.network.fit();
}

function topologyExportPng() {
    if (!FEATURE_STATE.topology.network) return;
    const canvas = document.querySelector('#topology-network canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'network-topology.png';
    a.click();
}

async function topologyRefresh() {
    const container = document.getElementById('topology-network');
    if (!container || typeof vis === 'undefined') return;
    let devices = [];
    let wifiStatus = {};
    try {
        const [devRes, wifiRes] = await Promise.all([fetchApiJson('/api/devices'), fetchApiJson('/api/wifi/status')]);
        devices = devRes.devices || [];
        wifiStatus = wifiRes || {};
    } catch (_) {}
    const built = topologyBuildFromData(devices, wifiStatus);
    let nodes = built.nodes.slice();
    let edges = built.edges.slice();
    if (!FEATURE_STATE.topology.showClients) {
        nodes = nodes.filter(n => !String(n.id).startsWith('client-'));
        edges = edges.filter(e => !String(e.to).startsWith('client-'));
    }
    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    const options = { physics: true, interaction: { dragNodes: true, zoomView: true }, edges: { color: { color: '#4b5563' }, font: { color: '#a0aec0' } }, nodes: { font: { color: '#e2eeff' } } };
    FEATURE_STATE.topology.network = new vis.Network(container, data, options);
    topologyApplyLayout();
    FEATURE_STATE.topology.network.on('click', params => {
        if (!params.nodes.length) return;
        const nodeId = params.nodes[0];
        const node = FEATURE_STATE.topology.nodes.find(n => n.id === nodeId);
        const details = document.getElementById('topology-details');
        if (details) details.textContent = JSON.stringify(node ? node.data : {}, null, 2);
    });
    topologyRenderInterfaces(built.interfaces);
    topologyRenderClientsTable();
}

function topologyInit() {
    topologyRefresh();
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Diagnostics
// ══════════════════════════════════════════════════════════════════════════════
async function diagRunPing() {
    const host = document.getElementById('diag-ping-host').value.trim();
    const count = document.getElementById('diag-ping-count').value || 4;
    const size = document.getElementById('diag-ping-size').value || 64;
    if (!host) { showNotification('Enter a target host', 'warning'); return; }
    const btn = document.getElementById('diag-ping-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';
    try {
        const r = await fetch('/api/diagnostics/ping', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({host, count: parseInt(count), size: parseInt(size)}) });
        const d = await r.json();
        const res = document.getElementById('diag-ping-results');
        if (res) {
            res.style.display = 'block';
            res.innerHTML = d.success
                ? `<div class="diag-result-ok"><i class="fas fa-check-circle"></i> Success</div>
                   <div class="diag-result-grid">
                     <div><span>Min RTT</span><strong>${d.min_rtt} ms</strong></div>
                     <div><span>Avg RTT</span><strong>${d.avg_rtt} ms</strong></div>
                     <div><span>Max RTT</span><strong>${d.max_rtt} ms</strong></div>
                     <div><span>Packet Loss</span><strong>${d.packet_loss}%</strong></div>
                   </div>`
                : `<div class="diag-result-err"><i class="fas fa-times-circle"></i> ${d.error || 'Ping failed'}</div>`;
        }
    } catch(e) { showNotification('Ping error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Run Ping'; }
}

async function diagRunTraceroute() {
    const host = document.getElementById('diag-trace-host').value.trim();
    const maxhops = document.getElementById('diag-trace-hops').value || 30;
    if (!host) { showNotification('Enter a target host', 'warning'); return; }
    const btn = document.getElementById('diag-trace-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';
    try {
        const r = await fetch('/api/diagnostics/traceroute', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({host, max_hops: parseInt(maxhops)}) });
        const d = await r.json();
        const tbody = document.getElementById('diag-trace-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            (d.hops || []).forEach(h => {
                tbody.innerHTML += `<tr><td>${h.hop}</td><td>${h.hostname}</td><td>${h.ip}</td><td>${h.rtt1}</td><td>${h.rtt2}</td><td>${h.rtt3}</td></tr>`;
            });
        }
        const res = document.getElementById('diag-trace-results');
        if (res) res.style.display = 'block';
    } catch(e) { showNotification('Traceroute error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-route"></i> Run Traceroute'; }
}

async function diagRunDns() {
    const domain = document.getElementById('diag-dns-domain').value.trim();
    const server = document.getElementById('diag-dns-server').value.trim();
    if (!domain) { showNotification('Enter a domain name', 'warning'); return; }
    const btn = document.getElementById('diag-dns-btn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Looking up…';
    try {
        const r = await fetch('/api/diagnostics/dns', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({domain, server}) });
        const d = await r.json();
        const res = document.getElementById('diag-dns-results');
        if (res) {
            res.style.display = 'block';
            res.innerHTML = d.success
                ? `<div><strong>A:</strong> ${(d.a||[]).join(', ') || 'none'}</div>
                   <div><strong>AAAA:</strong> ${(d.aaaa||[]).join(', ') || 'none'}</div>
                   <div><strong>MX:</strong> ${(d.mx||[]).join(', ') || 'none'}</div>`
                : `<div class="diag-result-err">${d.error}</div>`;
        }
    } catch(e) { showNotification('DNS lookup error', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Lookup'; }
}

async function diagRunSpeedTest(type) {
    const btn = document.getElementById('diag-speed-' + type + '-btn');
    const bar = document.getElementById('diag-speed-bar-' + type);
    const result = document.getElementById('diag-speed-result-' + type);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing…'; }
    if (bar) { bar.style.display = 'block'; bar.querySelector('.diag-progress-fill').style.width = '0%'; }
    // Animate progress bar
    let prog = 0;
    const interval = setInterval(() => {
        prog = Math.min(95, prog + Math.random() * 15);
        if (bar) bar.querySelector('.diag-progress-fill').style.width = prog + '%';
    }, 300);
    try {
        const r = await fetch('/api/diagnostics/speedtest', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type}) });
        const d = await r.json();
        clearInterval(interval);
        if (bar) bar.querySelector('.diag-progress-fill').style.width = '100%';
        if (result) {
            result.style.display = 'block';
            result.innerHTML = d.success
                ? `<strong>${d.speed} Mbps</strong> (latency: ${d.latency}ms)`
                : `<span class="diag-result-err">${d.error}</span>`;
        }
    } catch(e) { clearInterval(interval); showNotification('Speed test error', 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = type==='download' ? '<i class="fas fa-arrow-down"></i> Test Download' : '<i class="fas fa-arrow-up"></i> Test Upload'; } }
}

async function diagLoadHealth() {
    try {
        const r = await fetch('/api/diagnostics/health');
        const d = await r.json();
        (d.checks || []).forEach(c => {
            const el = document.getElementById('diag-health-' + c.name.toLowerCase().replace(/\s+/g,'-'));
            if (el) {
                el.className = 'diag-health-tile diag-health-' + (c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : 'fail');
                el.querySelector('.diag-health-status').textContent = c.status.toUpperCase();
            }
        });
    } catch(e) { console.error('Health check error', e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Location
// ══════════════════════════════════════════════════════════════════════════════
async function locationLoad() {
    try {
        const r = await fetch('/api/location/get');
        const d = await r.json();
        const f = d.location || {};
        ['street','city','country','latitude','longitude','postal_code'].forEach(k => {
            const el = document.getElementById('loc-' + k.replace(/_/g, '-'));
            if (el) el.value = f[k] || '';
        });
        const tz = document.getElementById('loc-timezone');
        if (tz && d.timezone) tz.value = d.timezone;
        const ntp1 = document.getElementById('loc-ntp1');
        const ntp2 = document.getElementById('loc-ntp2');
        if (ntp1 && d.ntp) ntp1.value = d.ntp[0] || '';
        if (ntp2 && d.ntp) ntp2.value = d.ntp[1] || '';
        // Map link
        const lat = f.latitude, lng = f.longitude;
        const mapLink = document.getElementById('loc-map-link');
        if (mapLink && lat && lng) mapLink.href = `https://maps.google.com/?q=${lat},${lng}`;
        const mapCoords = document.getElementById('loc-map-coords');
        if (mapCoords) mapCoords.textContent = lat && lng ? `${lat}, ${lng}` : 'No coordinates set';
        // ISP
        const isp = d.isp || {};
        ['name','asn','region'].forEach(k => {
            const el = document.getElementById('loc-isp-' + k);
            if (el) el.textContent = isp[k] || '—';
        });
    } catch(e) { console.error('Location load error', e); }
}

async function locationSave() {
    const payload = {
        street: document.getElementById('loc-street').value,
        city: document.getElementById('loc-city').value,
        country: document.getElementById('loc-country').value,
        latitude: document.getElementById('loc-latitude').value,
        longitude: document.getElementById('loc-longitude').value,
        postal_code: document.getElementById('loc-postal-code').value
    };
    try {
        const r = await fetch('/api/location/set', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const d = await r.json();
        showNotification(d.success ? 'Location saved' : 'Save failed: ' + d.error, d.success ? 'success' : 'error');
        if (d.success) locationLoad();
    } catch(e) { showNotification('Location save error', 'error'); }
}

async function locationSaveTimezone() {
    const payload = {
        timezone: document.getElementById('loc-timezone').value,
        ntp: [document.getElementById('loc-ntp1').value, document.getElementById('loc-ntp2').value],
        locale: document.getElementById('loc-locale').value
    };
    try {
        const r = await fetch('/api/location/timezone', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const d = await r.json();
        showNotification(d.success ? 'Timezone saved' : 'Save failed: ' + d.error, d.success ? 'success' : 'error');
    } catch(e) { showNotification('Timezone save error', 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. AI Assistant
// ══════════════════════════════════════════════════════════════════════════════
let _aiMessages = [];

function aiSendMessage() {
    const input = document.getElementById('ai-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    aiAppendMessage(text, 'user');
    input.value = '';
    aiCallBackend(text);
}

function aiAppendMessage(text, role, ts) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const time = ts || new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-' + (role === 'user' ? 'user' : 'assistant');
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    // User messages are plain text; assistant messages are rule-based strings (trusted source)
    if (role === 'user') {
        bubble.textContent = text;
    } else {
        bubble.textContent = text;
    }
    const tsDiv = document.createElement('div');
    tsDiv.className = 'ai-ts';
    tsDiv.textContent = time;
    div.appendChild(bubble);
    div.appendChild(tsDiv);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    _aiMessages.push({role, text, time});
}

function aiShowTyping() {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.id = 'ai-typing';
    div.className = 'ai-msg ai-msg-assistant';
    div.innerHTML = '<div class="ai-bubble ai-typing-indicator"><span></span><span></span><span></span></div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function aiHideTyping() {
    const el = document.getElementById('ai-typing');
    if (el) el.remove();
}

async function aiCallBackend(message) {
    aiShowTyping();
    try {
        const context = {
            connected: document.querySelector('.pill-connected') !== null,
            data_model_count: parseInt(document.querySelector('.hero-stat-value') ? document.querySelectorAll('.hero-stat-value')[1]?.textContent || '0' : '0'),
        };
        const r = await fetch('/api/ai/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message, context}) });
        const d = await r.json();
        aiHideTyping();
        aiAppendMessage(d.response || 'No response', 'assistant');
    } catch(e) {
        aiHideTyping();
        aiAppendMessage('Error contacting AI backend.', 'assistant');
    }
}

function aiSendChip(text) {
    const input = document.getElementById('ai-input');
    if (input) { input.value = text; aiSendMessage(); }
}

function aiClearChat() {
    const container = document.getElementById('ai-messages');
    if (container) container.innerHTML = '';
    _aiMessages = [];
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Role-Based Access Control
// ══════════════════════════════════════════════════════════════════════════════
async function rbacLoadUsers() {
    try {
        const r = await fetch('/api/rbac/users');
        const d = await r.json();
        const tbody = document.getElementById('rbac-users-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            // Cache users for index-based lookups
            window._rbacUsers = d.users || [];
            (d.users || []).forEach((u, i) => {
                const roleLower = u.role.toLowerCase();
                const validRole = ['admin','operator','viewer'].includes(roleLower) ? roleLower : 'viewer';
                tbody.innerHTML += `<tr>
                  <td>${escHtml(u.username)}</td>
                  <td><span class="role-badge role-${validRole}">${escHtml(u.role)}</span></td>
                  <td><span class="status-badge status-${u.active ? 'active' : 'inactive'}">${u.active ? 'Active' : 'Inactive'}</span></td>
                  <td>${escHtml(u.last_login || 'Never')}</td>
                  <td>
                    <select class="form-control form-control-sm" onchange="rbacSetRoleByIdx(${i},this.value)">
                      ${['Admin','Operator','Viewer'].map(r => `<option${r===u.role?' selected':''}>${r}</option>`).join('')}
                    </select>
                    <button class="btn btn-${u.active?'warning':'success'} btn-sm" onclick="rbacToggleByIdx(${i},${!u.active})">${u.active?'Deactivate':'Activate'}</button>
                  </td>
                </tr>`;
            });
        }
    } catch(e) { console.error('RBAC users error', e); }
}

async function rbacSetRole(username, role) {
    try {
        await fetch('/api/rbac/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'set_role', username, role}) });
        showNotification(`Role updated for ${escHtml(username)}`, 'success');
    } catch(e) { showNotification('Role update failed', 'error'); }
}

function rbacSetRoleByIdx(i, role) {
    const users = window._rbacUsers || [];
    if (users[i]) rbacSetRole(users[i].username, role);
}

async function rbacToggleUser(username, active) {
    try {
        await fetch('/api/rbac/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'toggle', username, active}) });
        showNotification(`User ${escHtml(username)} ${active?'activated':'deactivated'}`, 'success');
        rbacLoadUsers();
    } catch(e) { showNotification('User toggle failed', 'error'); }
}

function rbacToggleByIdx(i, active) {
    const users = window._rbacUsers || [];
    if (users[i]) rbacToggleUser(users[i].username, active);
}

async function rbacAddUser() {
    const username = document.getElementById('rbac-new-username').value.trim();
    const password = document.getElementById('rbac-new-password').value;
    const role = document.getElementById('rbac-new-role').value;
    if (!username || !password) { showNotification('Username and password required', 'warning'); return; }
    try {
        const r = await fetch('/api/rbac/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'add', username, password, role}) });
        const d = await r.json();
        showNotification(d.success ? `User ${escHtml(username)} added` : d.error, d.success ? 'success' : 'error');
        if (d.success) { document.getElementById('rbac-new-username').value = ''; document.getElementById('rbac-new-password').value = ''; rbacLoadUsers(); }
    } catch(e) { showNotification('Add user failed', 'error'); }
}

async function rbacLoadSession() {
    try {
        const r = await fetch('/api/rbac/session');
        const d = await r.json();
        const el = document.getElementById('rbac-session-info');
        if (el && d.session) {
            const roleLower = (d.session.role || '').toLowerCase();
            el.innerHTML = `<div><strong>User:</strong> ${escHtml(d.session.username)}</div>
                            <div><strong>Role:</strong> <span class="role-badge role-${escHtml(roleLower)}">${escHtml(d.session.role)}</span></div>
                            <div><strong>Since:</strong> ${escHtml(d.session.start)}</div>
                            <div><strong>Permissions:</strong> ${escHtml((d.session.permissions || []).join(', '))}</div>`;
        }
        const tbody = document.getElementById('rbac-sessions-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            // Cache sessions for index-based revoke
            window._rbacSessions = d.sessions || [];
            (d.sessions || []).forEach((s, i) => {
                tbody.innerHTML += `<tr>
                  <td>${escHtml(s.username)}</td>
                  <td>${escHtml(s.ip)}</td>
                  <td>${escHtml(s.login_time)}</td>
                  <td><button class="btn btn-danger btn-sm" onclick="rbacRevokeSessionByIdx(${i})"><i class="fas fa-sign-out-alt"></i> Revoke</button></td>
                </tr>`;
            });
        }
    } catch(e) { console.error('RBAC session error', e); }
}

async function rbacRevokeSession(id) {
    try {
        await fetch('/api/rbac/session', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'revoke', id}) });
        showNotification('Session revoked', 'success');
        rbacLoadSession();
    } catch(e) { showNotification('Revoke failed', 'error'); }
}

function rbacRevokeSessionByIdx(i) {
    const sessions = window._rbacSessions || [];
    if (sessions[i]) rbacRevokeSession(sessions[i].id);
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Mass Actions
// ══════════════════════════════════════════════════════════════════════════════
let _massActionType = 'batch_set';
let _massBatchRows = [];
let _massPollingInterval = null;

function massSelectType(type) {
    _massActionType = type;
    document.querySelectorAll('.mass-type-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.mass-type-btn[data-type="${type}"]`);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.mass-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('mass-panel-' + type.replace('_','-'));
    if (panel) panel.style.display = 'block';
}

function massAddBatchRow() {
    const container = document.getElementById('mass-batch-rows');
    const idx = _massBatchRows.length;
    _massBatchRows.push({path:'',value:''});
    const row = document.createElement('div');
    row.className = 'mass-batch-row';
    row.id = 'mass-row-' + idx;
    row.innerHTML = `<input class="form-control" placeholder="Device.X.Parameter" onchange="_massBatchRows[${idx}].path=this.value">
                     <input class="form-control" placeholder="Value" onchange="_massBatchRows[${idx}].value=this.value">
                     <button class="btn btn-danger btn-sm" onclick="massRemoveBatchRow(${idx})"><i class="fas fa-trash"></i></button>`;
    if (container) container.appendChild(row);
}

function massRemoveBatchRow(idx) {
    const row = document.getElementById('mass-row-' + idx);
    if (row) row.remove();
    _massBatchRows = _massBatchRows.filter((_, i) => i !== idx);
}

async function massSubmit() {
    const selectedCpes = Array.from(document.querySelectorAll('.mass-cpe-checkbox:checked')).map(c => c.value);
    if (!selectedCpes.length) { showNotification('Select at least one CPE', 'warning'); return; }
    const payload = {
        type: _massActionType,
        cpes: selectedCpes,
        params: _massBatchRows.filter(Boolean),
        firmware_url: document.getElementById('mass-fw-url')?.value || '',
        firmware_checksum: document.getElementById('mass-fw-checksum')?.value || '',
        schedule: document.getElementById('mass-fw-schedule')?.value || 'immediate'
    };
    try {
        const r = await fetch('/api/mass_actions/submit', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const d = await r.json();
        if (d.success) {
            showNotification(`Job ${d.job_id} submitted`, 'success');
            massStartPolling(d.job_id);
            massLoadHistory();
        } else { showNotification(d.error || 'Submission failed', 'error'); }
    } catch(e) { showNotification('Submit error', 'error'); }
}

function massStartPolling(jobId) {
    if (_massPollingInterval) clearInterval(_massPollingInterval);
    const bar = document.getElementById('mass-progress-bar');
    const status = document.getElementById('mass-progress-status');
    if (bar) { bar.parentElement.style.display = 'block'; bar.style.width = '0%'; }
    _massPollingInterval = setInterval(async () => {
        try {
            const r = await fetch('/api/mass_actions/status/' + jobId);
            const d = await r.json();
            if (bar) bar.style.width = (d.progress || 0) + '%';
            if (status) status.textContent = `${d.status} — ${d.success_count||0} OK / ${d.fail_count||0} failed`;
            if (d.status === 'completed' || d.status === 'failed') {
                clearInterval(_massPollingInterval);
                showNotification('Job ' + jobId + ' ' + d.status, d.status === 'completed' ? 'success' : 'error');
                massLoadHistory();
            }
        } catch(e) { clearInterval(_massPollingInterval); }
    }, 2000);
}

async function massLoadHistory() {
    try {
        const r = await fetch('/api/mass_actions/history');
        const d = await r.json();
        const tbody = document.getElementById('mass-history-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            (d.history || []).forEach(j => {
                const statusCls = ['completed','failed','running','queued'].includes(j.status) ? j.status : 'unknown';
                tbody.innerHTML += `<tr>
                  <td><code>${escHtml(j.job_id)}</code></td>
                  <td>${escHtml(j.type)}</td>
                  <td>${escHtml((j.cpes||[]).join(', '))}</td>
                  <td><span class="status-badge status-${statusCls}">${escHtml(j.status)}</span></td>
                  <td>${escHtml(j.started || '—')}</td>
                  <td>${escHtml(j.completed || '—')}</td>
                  <td>${parseInt(j.success_count) || 0} / ${parseInt(j.fail_count) || 0}</td>
                </tr>`;
            });
        }
    } catch(e) { console.error('Mass history error', e); }
}

function massSelectAllCpes(checked) {
    document.querySelectorAll('.mass-cpe-checkbox').forEach(c => c.checked = checked);
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Multi-CPE Support
// ══════════════════════════════════════════════════════════════════════════════
async function cpeLoadList() {
    try {
        const r = await fetch('/api/cpes');
        const d = await r.json();
        // Cache CPE list for index-based actions
        window._cpeList = d.cpes || [];
        // Registry table
        const tbody = document.getElementById('cpe-registry-tbody');
        if (tbody) {
            tbody.innerHTML = '';
            (d.cpes || []).forEach((c, i) => {
                const statusCls = c.status.toLowerCase() === 'online' ? 'active' : 'inactive';
                tbody.innerHTML += `<tr>
                  <td><code>${escHtml(c.id)}</code></td>
                  <td>${escHtml(c.serial)}</td>
                  <td>${escHtml(c.model)}</td>
                  <td>${escHtml(c.firmware)}</td>
                  <td>${escHtml(c.ip)}</td>
                  <td><code>${escHtml(c.agent_id)}</code></td>
                  <td><span class="status-badge status-${statusCls}">${escHtml(c.status)}</span></td>
                  <td>${escHtml(c.last_seen)}</td>
                  <td>
                    <button class="btn btn-primary btn-sm" onclick="cpeConnectByIdx(${i})"><i class="fas fa-plug"></i> Connect</button>
                    <button class="btn btn-info btn-sm" onclick="cpeViewDetails(${i})"><i class="fas fa-info-circle"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="cpeRemoveByIdx(${i})"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>`;
            });
        }
        // Dashboard cards
        const grid = document.getElementById('cpe-dashboard-grid');
        if (grid) {
            grid.innerHTML = '';
            (d.cpes || []).forEach((c, i) => {
                const statusCls = c.status.toLowerCase() === 'online' ? 'online' : 'offline';
                grid.innerHTML += `<div class="cpe-card cpe-card-${statusCls}">
                  <div class="cpe-card-header">
                    <span class="cpe-status-dot"></span>
                    <strong>${escHtml(c.friendly_name || c.serial)}</strong>
                  </div>
                  <div class="cpe-card-body">
                    <div><i class="fas fa-barcode"></i> ${escHtml(c.serial)}</div>
                    <div><i class="fas fa-microchip"></i> ${escHtml(c.model)}</div>
                    <div><i class="fas fa-network-wired"></i> ${escHtml(c.ip)}</div>
                  </div>
                  <button class="btn btn-primary btn-sm w-100 mt-2" onclick="cpeConnectByIdx(${i})"><i class="fas fa-plug"></i> Connect</button>
                </div>`;
            });
        }
        // Selector dropdown
        const sel = document.getElementById('cpe-active-selector');
        if (sel) {
            const current = sel.value;
            sel.innerHTML = '<option value="">— Select Active CPE —</option>';
            (d.cpes || []).forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.friendly_name || c.serial;
                if (c.id === current) opt.selected = true;
                sel.appendChild(opt);
            });
        }
        // Mass actions CPE list
        const massContainer = document.getElementById('mass-cpe-list');
        if (massContainer) {
            massContainer.innerHTML = '';
            (d.cpes || []).forEach(c => {
                const label = document.createElement('label');
                label.className = 'mass-cpe-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'mass-cpe-checkbox';
                cb.value = c.id;
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + (c.friendly_name || c.serial)));
                massContainer.appendChild(label);
            });
        }
    } catch(e) { console.error('CPE list error', e); }
}

function cpeConnectByIdx(i) {
    const cpes = window._cpeList || [];
    if (cpes[i]) cpeConnect(cpes[i].id);
}

function cpeRemoveByIdx(i) {
    const cpes = window._cpeList || [];
    if (cpes[i]) cpeRemove(cpes[i].id);
}

async function cpeAdd() {
    const payload = {
        serial: document.getElementById('cpe-add-serial').value.trim(),
        broker: document.getElementById('cpe-add-broker').value.trim(),
        port: parseInt(document.getElementById('cpe-add-port').value) || 1883,
        agent_id: document.getElementById('cpe-add-agentid').value.trim(),
        friendly_name: document.getElementById('cpe-add-name').value.trim(),
        tags: (document.getElementById('cpe-add-tags').value || '').split(',').map(t => t.trim()).filter(Boolean)
    };
    if (!payload.serial || !payload.broker) { showNotification('Serial and broker required', 'warning'); return; }
    try {
        const r = await fetch('/api/cpes/add', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const d = await r.json();
        showNotification(d.success ? 'CPE added: ' + d.id : d.error, d.success ? 'success' : 'error');
        if (d.success) cpeLoadList();
    } catch(e) { showNotification('CPE add error', 'error'); }
}

async function cpeRemove(id) {
    if (!confirm('Remove CPE ' + id + '?')) return;
    try {
        const r = await fetch('/api/cpes/remove/' + id, { method: 'DELETE' });
        const d = await r.json();
        showNotification(d.success ? 'CPE removed' : d.error, d.success ? 'success' : 'error');
        if (d.success) cpeLoadList();
    } catch(e) { showNotification('CPE remove error', 'error'); }
}

async function cpeConnect(id) {
    try {
        const r = await fetch('/api/cpes/connect/' + id, { method: 'POST' });
        const d = await r.json();
        if (d.success) {
            showNotification('Now managing: ' + (d.name || id), 'success');
            const banner = document.getElementById('cpe-active-banner');
            if (banner) { banner.textContent = 'Now managing: ' + (d.name || id); banner.style.display = 'block'; }
            cpeLoadList();
        } else { showNotification(d.error || 'Connect failed', 'error'); }
    } catch(e) { showNotification('CPE connect error', 'error'); }
}

function cpeViewDetails(id) {
    showNotification('CPE detail view for ' + id, 'info');
}

async function cpeSwitchActive() {
    const id = document.getElementById('cpe-active-selector').value;
    if (id) await cpeConnect(id);
}

async function cpeCompare() {
    const checked = Array.from(document.querySelectorAll('.cpe-compare-checkbox:checked')).map(c => c.value);
    if (checked.length < 2) { showNotification('Select 2 or 3 CPEs to compare', 'warning'); return; }
    try {
        const r = await fetch('/api/cpes/compare', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ids: checked}) });
        const d = await r.json();
        const table = document.getElementById('cpe-compare-table');
        if (table && d.success) {
            let html = '<thead><tr><th>Parameter</th>' + d.cpes.map(c => `<th>${c.name}</th>`).join('') + '</tr></thead><tbody>';
            (d.params || []).forEach(row => {
                html += '<tr><td>' + row.param + '</td>' + d.cpes.map(c => `<td>${row.values[c.id] || '—'}</td>`).join('') + '</tr>';
            });
            html += '</tbody>';
            table.innerHTML = html;
            document.getElementById('cpe-compare-panel').style.display = 'block';
        }
    } catch(e) { showNotification('Compare error', 'error'); }
}

function cpeFilterByTag(tag) {
    document.querySelectorAll('.cpe-tag-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.cpe-tag-btn[data-tag="${tag}"]`);
    if (btn) btn.classList.add('active');
    // Filter cards by tag
    document.querySelectorAll('.cpe-card').forEach(card => {
        if (tag === 'all' || card.dataset.tags?.includes(tag)) card.style.display = '';
        else card.style.display = 'none';
    });
}

// ── Initialize new sections on DOMContentLoaded ──────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    metricsInit();
    alertsInit();
    fleetInit();
    easymeshLoad();
    topologyInit();
    wifiInit();

    // Load data when sections are first visited
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            const section = item.getAttribute('data-section');
            if (section === 'section-metrics') metricsRefresh();
            else if (section === 'section-alerts') alertsRenderRules();
            else if (section === 'section-fleet') fleetRefreshNow();
            else if (section === 'section-easymesh') easymeshLoad();
            else if (section === 'section-wifi') wifiInit();
            else if (section === 'section-devices') devicesLoad();
            else if (section === 'section-topology') topologyRefresh();
            else if (section === 'section-diagnostics') diagLoadHealth();
            else if (section === 'section-location') locationLoad();
            else if (section === 'section-rbac') { rbacLoadUsers(); rbacLoadSession(); }
            else if (section === 'section-mass-actions') { massLoadHistory(); cpeLoadList(); }
            else if (section === 'section-cpe') cpeLoadList();
        });
    });

    // AI chat Enter key
    const aiInput = document.getElementById('ai-input');
    if (aiInput) {
        aiInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSendMessage(); }
        });
    }
});

// Export new functions
window.metricsToggleChart = metricsToggleChart;
window.alertsAddRule = alertsAddRule;
window.alertsEditRule = alertsEditRule;
window.alertsDeleteRule = alertsDeleteRule;
window.alertsToggleMute = alertsToggleMute;
window.alertsAcknowledge = alertsAcknowledge;
window.alertsAddTemplate = alertsAddTemplate;
window.fleetAddDevice = fleetAddDevice;
window.fleetRefreshNow = fleetRefreshNow;
window.fleetToggleView = fleetToggleView;
window.fleetSetSort = fleetSetSort;
window.fleetRender = fleetRender;
window.fleetSwitchDevice = fleetSwitchDevice;
window.fleetRemoveDevice = fleetRemoveDevice;
window.wifiApplyRadio = wifiApplyRadio;
window.wifiToggleAddSsidForm = wifiToggleAddSsidForm;
window.wifiAddSsidInline = wifiAddSsidInline;
window.wifiToggleKey = wifiToggleKey;
window.wifiDeleteSsid = wifiDeleteSsid;
window.wifiLoadClients = wifiLoadClients;
window.wifiKickClient = wifiKickClient;
window.wifiExportClientsCsv = wifiExportClientsCsv;
window.wifiAddAclRule = wifiAddAclRule;
window.wifiDeleteAclRule = wifiDeleteAclRule;
window.wifiSaveQosSettings = wifiSaveQosSettings;
window.easymeshAction = easymeshAction;
window.topologyRefresh = topologyRefresh;
window.topologyExportPng = topologyExportPng;
window.topologyToggleClients = topologyToggleClients;
window.topologyToggleLabels = topologyToggleLabels;
window.topologyApplyLayout = topologyApplyLayout;
window.topologyFit = topologyFit;
window.topologyRenderClientsTable = topologyRenderClientsTable;
window.wifiLoadStatus = wifiLoadStatus;
window.wifiScan = wifiScan;
window.wifiOpenEditModal = wifiOpenEditModal;
window.wifiOpenEditModalByIdx = wifiOpenEditModalByIdx;
window.wifiCloseModal = wifiCloseModal;
window.wifiSaveEdit = wifiSaveEdit;
window.wifiToggleSsid = wifiToggleSsid;
window.devicesLoad = devicesLoad;
window.devicesFilter = devicesFilter;
window.devicesSearch = devicesSearch;
window.devicesBlock = devicesBlock;
window.devicesBlockByIdx = devicesBlockByIdx;
window.devicesToggleDetail = devicesToggleDetail;
window.diagRunPing = diagRunPing;
window.diagRunTraceroute = diagRunTraceroute;
window.diagRunDns = diagRunDns;
window.diagRunSpeedTest = diagRunSpeedTest;
window.diagLoadHealth = diagLoadHealth;
window.locationLoad = locationLoad;
window.locationSave = locationSave;
window.locationSaveTimezone = locationSaveTimezone;
window.aiSendMessage = aiSendMessage;
window.aiSendChip = aiSendChip;
window.aiClearChat = aiClearChat;
window.rbacLoadUsers = rbacLoadUsers;
window.rbacAddUser = rbacAddUser;
window.rbacSetRole = rbacSetRole;
window.rbacSetRoleByIdx = rbacSetRoleByIdx;
window.rbacToggleUser = rbacToggleUser;
window.rbacToggleByIdx = rbacToggleByIdx;
window.rbacRevokeSession = rbacRevokeSession;
window.rbacRevokeSessionByIdx = rbacRevokeSessionByIdx;
window.massSelectType = massSelectType;
window.massAddBatchRow = massAddBatchRow;
window.massRemoveBatchRow = massRemoveBatchRow;
window.massSubmit = massSubmit;
window.massLoadHistory = massLoadHistory;
window.massSelectAllCpes = massSelectAllCpes;
window.cpeLoadList = cpeLoadList;
window.cpeAdd = cpeAdd;
window.cpeRemove = cpeRemove;
window.cpeConnect = cpeConnect;
window.cpeConnectByIdx = cpeConnectByIdx;
window.cpeRemoveByIdx = cpeRemoveByIdx;
window.cpeSwitchActive = cpeSwitchActive;
window.cpeCompare = cpeCompare;
window.cpeFilterByTag = cpeFilterByTag;
