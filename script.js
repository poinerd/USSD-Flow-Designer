const canvas = document.getElementById('canvas');
const world = document.getElementById('world');
const svgCanvas = document.getElementById('svg-connections');
const paletteItems = document.querySelectorAll('.palette-item');
const modal = document.getElementById('editorModal');
const variantGroup = document.getElementById('variantGroup');
const variantSelect = document.getElementById('variantSelect');
const targetContainerGroup = document.getElementById('targetContainerGroup');
const containerSelect = document.getElementById('containerSelect');
const contentGroup = document.getElementById('contentGroup');
const inputContainer = document.getElementById('inputContainer');
const btnSave = document.getElementById('btnSave');
const btnCancel = document.getElementById('btnCancel');
const zoomVal = document.getElementById('zoomVal');

// Action Panel Elements
const actionPanel = document.getElementById('actionPanel');
const btnCloseActionPanel = document.getElementById('btnCloseActionPanel');
const functionPills = document.querySelectorAll('.function-pill');

// Pan / Zoom State
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let spacePressed = false;
let startPan = { x: 0, y: 0 };

// Canvas State
let draggedType = null;
let draggedFunctionPill = null;
let activeNode = null;
let selectedElement = null;
let initialPosition = { x: 0, y: 0 };
let editingTarget = null;
let offset = { x: 0, y: 0 };

let containerCounter = 1;
let nodesList = [];
let connections = [];
let undoStack = [];

let lastDroppedNode = null;
let pendingConnection = null;

/* LocalStorage Persistence Helper */
function saveCanvasState() {
  const serializedNodes = nodesList.map(node => {
    const embedded = Array.from(node.querySelectorAll('.embedded-node')).map(e => ({
      type: e.dataset.type,
      rawText: e.dataset.rawText,
      variant: e.dataset.variant
    }));

    return {
      id: node.dataset.nodeId || Math.random().toString(36).substr(2, 9),
      type: node.dataset.type,
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
      containerId: node.dataset.containerId || null,
      targetContainerId: node.dataset.targetContainerId || null,
      rawText: node.dataset.rawText || '',
      variant: node.dataset.variant || 'string',
      actionFunc: node.dataset.actionFunc || null,
      optionIds: node.dataset.optionIds || null,
      filledSlots: node.dataset.filledSlots || null,
      menuOptionId: node.dataset.menuOptionId || null,
      parentGroup: node.dataset.parentGroup || null,
      generated: node.dataset.generated || null,
      embedded: embedded
    };
  });

  const serializedConns = connections.map(c => ({
    fromId: c.fromNode.dataset.nodeId,
    toId: c.toNode.dataset.nodeId,
    portType: c.portType
  }));

  const data = {
    containerCounter,
    nodes: serializedNodes,
    connections: serializedConns
  };

  localStorage.setItem('ussd_canvas_state', JSON.stringify(data));
}

function loadCanvasState() {
  const raw = localStorage.getItem('ussd_canvas_state');
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    containerCounter = data.containerCounter || 1;

    world.querySelectorAll('.node').forEach(n => n.remove());
    nodesList = [];
    connections = [];

    const idMap = {};

    data.nodes.forEach(nData => {
      const node = createNode(nData.type, nData.x, nData.y, nData.containerId);
      node.dataset.nodeId = nData.id;
      idMap[nData.id] = node;

      if (nData.width && (nData.type === 'container' || nData.type === 'group-container')) node.style.width = `${nData.width}px`;
      if (nData.height && (nData.type === 'container' || nData.type === 'group-container')) node.style.height = `${nData.height}px`;

      if (nData.targetContainerId) node.dataset.targetContainerId = nData.targetContainerId;
      if (nData.rawText) node.dataset.rawText = nData.rawText;
      if (nData.variant) node.dataset.variant = nData.variant;
      if (nData.optionIds) node.dataset.optionIds = nData.optionIds;
      if (nData.filledSlots) node.dataset.filledSlots = nData.filledSlots;
      if (nData.menuOptionId) node.dataset.menuOptionId = nData.menuOptionId;
      if (nData.parentGroup) node.dataset.parentGroup = nData.parentGroup;
      if (nData.generated) node.dataset.generated = nData.generated;

      if (nData.actionFunc) {
        node.dataset.actionFunc = nData.actionFunc;
        let pillEl = node.querySelector('.action-function-pill');
        if (!pillEl) {
          pillEl = document.createElement('div');
          pillEl.className = 'action-function-pill';
          node.appendChild(pillEl);
        }
        pillEl.textContent = `⚙ ${nData.actionFunc}`;
      }

      if (nData.type === 'container') {
        const titleEl = node.querySelector('.node-title');
        if (titleEl) titleEl.textContent = `Menu ${nData.containerId}`;
      } else if (nData.type !== 'group-container') {
        const container = node.querySelector('.node-text-container');
        if (container) container.innerHTML = renderFormattedText(nData.rawText, nData.variant, nData.containerId);
      }

      if (nData.menuOptionId && nData.generated) {
        const slotBadge = document.createElement('div');
        slotBadge.className = 'group-slot-badge';
        slotBadge.textContent = `Opt ${nData.menuOptionId}`;
        slotBadge.style.cssText = 'position:absolute;top:-9px;left:-4px;font-size:9px;font-weight:700;background:#0ea5e9;color:#fff;padding:1px 5px;border-radius:4px;pointer-events:none;z-index:3;';
        node.appendChild(slotBadge);
      }

      if (nData.embedded && nData.embedded.length > 0) {
        nData.embedded.forEach(emb => {
          addEmbeddedNodeToContainer(node, emb.type, emb.rawText, emb.variant);
        });
      }
    });

    // Re-nest any node that belongs inside a group-container (must run after all
    // nodes exist, since a group's children may be serialized before or after it)
    data.nodes.forEach(nData => {
      if (nData.parentGroup && idMap[nData.parentGroup] && idMap[nData.id]) {
        const parentGroupNode = idMap[nData.parentGroup];
        const childNode = idMap[nData.id];
        parentGroupNode.appendChild(childNode);
        childNode.style.position = 'relative';
        childNode.style.left = 'auto';
        childNode.style.top = 'auto';
      }
    });

    data.connections.forEach(cData => {
      const from = idMap[cData.fromId];
      const to = idMap[cData.toId];
      if (from && to) {
        connections.push({ fromNode: from, toNode: to, portType: cData.portType });
      }
    });

    refreshAllContainerLists();
    updateConnections();
  } catch (err) {
    console.error('Failed to load saved state:', err);
  }
}

function updateTransform() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  zoomVal.textContent = `${Math.round(scale * 100)}%`;
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / scale,
    y: (clientY - rect.top - panY) / scale
  };
}

// Key Listeners
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !spacePressed && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
    spacePressed = true;
    canvas.classList.add('panning');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spacePressed = false;
    canvas.classList.remove('panning');
  }
});

// Zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = 1.1;
  let newScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;
  newScale = Math.min(Math.max(0.2, newScale), 3);

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  panX = mouseX - (mouseX - panX) * (newScale / scale);
  panY = mouseY - (mouseY - panY) * (newScale / scale);
  scale = newScale;

  updateTransform();
}, { passive: false });

// Pan Mouse Events
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && spacePressed)) {
    isPanning = true;
    startPan = { x: e.clientX - panX, y: e.clientY - panY };
    canvas.classList.add('panning');
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (isPanning) {
    panX = e.clientX - startPan.x;
    panY = e.clientY - startPan.y;
    updateTransform();
  }
});

document.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    if (!spacePressed) canvas.classList.remove('panning');
  }
});

const resizeObserver = new ResizeObserver(() => updateConnections());

paletteItems.forEach(item => {
  item.addEventListener('dragstart', () => { draggedType = item.dataset.type; });
});

functionPills.forEach(pill => {
  pill.addEventListener('dragstart', () => {
    draggedFunctionPill = pill.dataset.func;
  });
});

btnCloseActionPanel.addEventListener('click', () => {
  actionPanel.classList.remove('open');
});

canvas.addEventListener('dragover', (e) => e.preventDefault());

canvas.addEventListener('click', (e) => {
  if (e.target === canvas || e.target === world || e.target === svgCanvas) {
    clearSelection();
    cancelPendingConnection();
  }
});

/* Convert index to letter: 0 -> A, 1 -> B, etc. */
function indexToAlpha(index) {
  let alpha = '';
  while (index >= 0) {
    alpha = String.fromCharCode((index % 26) + 65) + alpha;
    index = Math.floor(index / 26) - 1;
  }
  return alpha;
}

/* Alternating ID Generator: Parent ID + Number/Letter depending on parent's last character */
function generateOptionId(parentId, index) {
  if (!parentId) return `${index + 1}`;
  const strId = String(parentId);
  const lastChar = strId.slice(-1);

  if (/\d/.test(lastChar)) {
    return `${strId}${indexToAlpha(index)}`; // Parent ends in number -> append Letter (1 -> 1A, 1B)
  } else {
    return `${strId}${index + 1}`;          // Parent ends in letter -> append Number (1A -> 1A1, 1A2)
  }
}

function findParentContainer(element) {
  let curr = element.parentElement;
  while (curr) {
    if (
      curr.classList &&
      curr.classList.contains('node') &&
      (
        curr.dataset.type === 'container' ||
        curr.dataset.type === 'group-container'
      )
    ) {
      return curr;
    }
    curr = curr.parentElement;
  }
  return null;
}

function highlightTargetContainer(targetId) {
  if (!targetId) return;
  const allContainers = document.querySelectorAll('.node[data-type="container"]');
  allContainers.forEach(c => {
    if (c.dataset.containerId === String(targetId)) {
      c.classList.add('target-highlight');
      setTimeout(() => c.classList.remove('target-highlight'), 2500);
    }
  });
}

/* Render text formatting with inherited ID badges */
function renderFormattedText(text, variant, parentContainerId = null) {
  if (!text || text.trim() === '') return '';
  const lines = text.split('\n').filter(line => line.trim() !== '');

  if (variant === 'ordered' || variant === 'unordered') {
    const listItems = lines.map((line, idx) => {
      const optId = generateOptionId(parentContainerId, idx);
      return `<li data-option-id="${optId}"><span class="option-badge" onclick="event.stopPropagation(); highlightTargetContainer('${optId}')">${optId}</span>${line}</li>`;
    }).join('');

    return variant === 'ordered' ? `<ol>${listItems}</ol>` : `<ul>${listItems}</ul>`;
  } else {
    return `<div>${lines.join('<br>')}</div>`;
  }
}

function refreshContainerLists(container) {
  if (!container || container.dataset.type !== 'container') return;
  const containerId = container.dataset.containerId;

  const embeddedNodes = container.querySelectorAll('.embedded-node');
  embeddedNodes.forEach(emb => {
    const variant = emb.dataset.variant;
    if (variant === 'ordered' || variant === 'unordered') {
      const badge = emb.dataset.type === 'input' ? '<b>[Input]:</b> ' : '';
      emb.innerHTML = badge + renderFormattedText(emb.dataset.rawText, variant, containerId);
    }
  });
}

function refreshAllContainerLists() {
  document.querySelectorAll('.node[data-type="container"]').forEach(c => refreshContainerLists(c));
}

/**
 * Automates creating a Group Container with embedded child Container Menus 
 * whose IDs match the generated Option IDs of the parent list.
 */
function autoGenerateGroupAndMenusForContainer(parentContainerNode, listText, variant) {
  if (variant !== 'ordered' && variant !== 'unordered') return;
  if (!listText || listText.trim() === '') return;

  const lines = listText
    .split('\n')
    .filter(line => line.trim() !== '');

  if (lines.length === 0) return;

  const parentId = parentContainerNode.dataset.containerId || '1';


  /*
    Remove previous generated group connected
    to this menu to avoid duplicates
  */
  const existingGroup = nodesList.find(node =>
    node.dataset.type === 'group-container' &&
    node.dataset.parentMenuId === parentId
  );


  if (existingGroup) {
    nodesList = nodesList.filter(n => n !== existingGroup);
    existingGroup.remove();
  }


  /*
    Position group container beside parent
  */
  const groupX =
    parentContainerNode.offsetLeft +
    parentContainerNode.offsetWidth +
    150;

  const groupY =
    parentContainerNode.offsetTop;


  /*
    Create Group Container (empty).
    Child menus/gotos are no longer auto-generated - the user drags them in
    manually, one per menu option, up to the slot budget below.
  */
  const groupContainer = createNode(
    'group-container',
    groupX,
    groupY
  );


  groupContainer.dataset.parentMenuId = parentId;

  /*
    Compute the full ordered list of option IDs this group is allowed to hold.
    Each option from the parent's list gets exactly one slot inside the group.
  */
  const optionIds = lines.map((line, index) => generateOptionId(parentId, index));
  groupContainer.dataset.optionIds = JSON.stringify(optionIds);
  groupContainer.dataset.filledSlots = '0';

  /*
    Connect parent menu -> group
  */
  connections =
    connections.filter(conn =>
      !(
        conn.fromNode === parentContainerNode &&
        conn.portType === "out"
      )
    );


  connections.push({
    fromNode: parentContainerNode,
    toNode: groupContainer,
    portType:"out"
  });


  updateConnections();
  saveCanvasState();
}

/**
 * Places a `container` or `goto` node into the next free slot of a group-container.
 * Each slot corresponds 1:1 with a menu option from the list that generated the group,
 * so the group can never hold more nodes than it has options. The new node's ID
 * (for containers) or menuOptionId tag (for gotos) is set to match that slot's option.
 * Returns the created node, or null if the group is already full.
 */
function addNodeToGroupContainer(groupContainer, type) {
  let optionIds = [];
  try {
    optionIds = JSON.parse(groupContainer.dataset.optionIds || '[]');
  } catch (err) {
    optionIds = [];
  }

  const filledSlots = parseInt(groupContainer.dataset.filledSlots || '0', 10);

  if (filledSlots >= optionIds.length) {
    alert(`This group container is full. It can only hold ${optionIds.length} item(s), one per menu option.`);
    return null;
  }

  const optionId = optionIds[filledSlots];

  const childNode = createNode(type, 0, 0, type === 'container' ? optionId : null);

  childNode.dataset.menuOptionId = optionId;
  childNode.dataset.parentGroup = groupContainer.dataset.nodeId;
  childNode.dataset.generated = 'true';

  if (type === 'container') {
    const title = childNode.querySelector('.node-title');
    if (title) title.textContent = `Menu ${optionId}`;
  }

  // Small badge showing which menu option this node fulfills
  const slotBadge = document.createElement('div');
  slotBadge.className = 'group-slot-badge';
  slotBadge.textContent = `Opt ${optionId}`;
  slotBadge.style.cssText = 'position:absolute;top:-9px;left:-4px;font-size:9px;font-weight:700;background:#0ea5e9;color:#fff;padding:1px 5px;border-radius:4px;pointer-events:none;z-index:3;';
  childNode.appendChild(slotBadge);

  // Put inside group visually
  groupContainer.appendChild(childNode);

  // Remove absolute positioning conflict
  childNode.style.position = 'relative';
  childNode.style.left = 'auto';
  childNode.style.top = 'auto';

  groupContainer.dataset.filledSlots = String(filledSlots + 1);

  updateConnections();
  saveCanvasState();
  return childNode;
}

/*
 * Connects sourceNode -> newNode, picking the right out-port (handles action
 * true/false branching the same way regardless of caller). Returns whichever
 * node the *next* sequential drop should chain from.
 */
function connectFromSource(sourceNode, newNode) {
  let portType = 'out';
  let nextChainNode = newNode;

  if (sourceNode.dataset.type === 'action') {
    const hasTrueConn = connections.some(c => c.fromNode === sourceNode && c.portType === 'out-true');
    const hasFalseConn = connections.some(c => c.fromNode === sourceNode && c.portType === 'out-false');

    if (!hasTrueConn) {
      portType = 'out-true';
    } else if (!hasFalseConn) {
      portType = 'out-false';
      const trueConn = connections.find(c => c.fromNode === sourceNode && c.portType === 'out-true');
      nextChainNode = trueConn ? trueConn.toNode : newNode;
    }
  }

  const isPortOccupied = connections.some(c => c.fromNode === sourceNode && c.portType === portType);
  if (!isPortOccupied) {
    connections.push({ fromNode: sourceNode, toNode: newNode, portType: portType });
    updateConnections();
  }

  return nextChainNode;
}

/*
 * Finds an existing node whose out-port is "beside" the drop point (to the left,
 * roughly the same height, within reach) and that still has a free out-port.
 * This lets the flow continue from ANY existing node - including a container
 * that lives inside a group-container - not just the single global last-dropped node.
 */
function findBesideSourceNode(clientX, clientY, excludeNode) {
  const REACH_X = 260;   // how far right of a node's out-port still counts as "beside" it
  const REACH_X_BEHIND = 20;
  const REACH_Y_PAD = 60; // vertical tolerance around the node's own height

  let best = null;
  let bestDist = Infinity;

  nodesList.forEach(n => {
    if (n === excludeNode) return;
    const t = n.dataset.type;
    if (t === 'end' || t === 'group-container' || t === 'text' || t === 'input') return;

    if (t === 'action') {
      const hasTrueConn = connections.some(c => c.fromNode === n && c.portType === 'out-true');
      const hasFalseConn = connections.some(c => c.fromNode === n && c.portType === 'out-false');
      if (hasTrueConn && hasFalseConn) return;
    } else {
      const hasOut = connections.some(c => c.fromNode === n && c.portType === 'out');
      if (hasOut) return;
    }

    const r = n.getBoundingClientRect();
    const portScreenX = r.right;
    const portScreenY = r.top + r.height / 2;

    const dx = clientX - portScreenX;
    const dy = clientY - portScreenY;

    if (dx < -REACH_X_BEHIND || dx > REACH_X) return;
    if (Math.abs(dy) > (r.height / 2 + REACH_Y_PAD)) return;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  });

  return best;
}

/* Drop Handler */
canvas.addEventListener('drop', (e) => {
  e.preventDefault();

  if (draggedFunctionPill) {
    const targetActionNode = nodesList.find(n => {
      if (n.dataset.type !== 'action') return false;
      const rect = n.getBoundingClientRect();
      return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    });

    if (targetActionNode) {
      targetActionNode.dataset.actionFunc = draggedFunctionPill;
      let pillEl = targetActionNode.querySelector('.action-function-pill');
      if (!pillEl) {
        pillEl = document.createElement('div');
        pillEl.className = 'action-function-pill';
        targetActionNode.appendChild(pillEl);
      }
      pillEl.textContent = `⚙ ${draggedFunctionPill}`;
      saveCanvasState();
    }
    draggedFunctionPill = null;
    return;
  }

  if (!draggedType) return;

  const worldPos = screenToWorld(e.clientX, e.clientY);
  const targetContainer = findContainerAtPoint(e.clientX, e.clientY, null);

  // Drop a container or goto directly into a group-container (slot-limited, ID-linked)
  if (targetContainer && targetContainer.dataset.type === 'group-container' && (draggedType === 'container' || draggedType === 'goto')) {
    addNodeToGroupContainer(targetContainer, draggedType);
    draggedType = null;
    return;
  }

  // Embed standalone text or input into an existing (non-group) container
  if ((draggedType === 'text' || draggedType === 'input') && targetContainer && targetContainer.dataset.type === 'container') {
    const defaultText = draggedType === 'text' ? 'Option 1\nOption 2' : 'User Input Field';
    addEmbeddedNodeToContainer(targetContainer, draggedType, defaultText);
    draggedType = null;
    saveCanvasState();
    return;
  }

  const newNode = createNode(draggedType, worldPos.x - 50, worldPos.y - 30);

  if (draggedType === 'action') {
    actionPanel.classList.add('open');
  }

  // Auto-connect: prefer a nearby existing node (e.g. a menu inside a group
  // container) over the global sequential chain, so the flow can branch out
  // from any menu, not just the most recently dropped node overall.
  if (draggedType !== 'text' && draggedType !== 'input') {
    const besideSource = findBesideSourceNode(e.clientX, e.clientY, newNode);

    if (besideSource) {
      lastDroppedNode = connectFromSource(besideSource, newNode);
    } else if (lastDroppedNode && lastDroppedNode.dataset.type !== 'end' && newNode.dataset.type !== 'start') {
      lastDroppedNode = connectFromSource(lastDroppedNode, newNode);
    } else {
      lastDroppedNode = newNode;
    }
  }

  draggedType = null;
  saveCanvasState();
});

function setSelected(el) {
  clearSelection();
  selectedElement = el;
  selectedElement.classList.add('selected');
}

function clearSelection() {
  if (selectedElement) {
    selectedElement.classList.remove('selected');
    selectedElement = null;
  }
}

function cancelPendingConnection() {
  if (pendingConnection) {
    if (pendingConnection.portEl) pendingConnection.portEl.classList.remove('port-active');
    pendingConnection = null;
  }
}

function findContainerAtPoint(screenX, screenY, excludeNode) {
  const allTargets = Array.from(document.querySelectorAll('.node[data-type="container"], .node[data-type="group-container"]'));

  const isInside = (el) => {
    if (el === excludeNode) return false;
    const r = el.getBoundingClientRect();
    return screenX >= r.left && screenX <= r.right && screenY >= r.top && screenY <= r.bottom;
  };

  // Prefer a plain "container" match first - a menu nested inside a group-container
  // should win over the group-container wrapping it (last match = deepest in DOM order).
  const matchingContainers = allTargets.filter(el => el.dataset.type === 'container' && isInside(el));
  if (matchingContainers.length > 0) {
    return matchingContainers[matchingContainers.length - 1];
  }

  // Otherwise fall back to a group-container match (e.g. dropping onto empty group space)
  return allTargets.find(el => el.dataset.type === 'group-container' && isInside(el)) || null;
}

function addEmbeddedNodeToContainer(container, type, text, variant = 'string') {
  const embeddedNode = document.createElement('div');
  embeddedNode.className = 'embedded-node';
  embeddedNode.dataset.type = type;
  embeddedNode.dataset.rawText = text;
  embeddedNode.dataset.variant = variant;

  const containerId = container.dataset.containerId || null;
  const badge = type === 'input' ? '<b>[Input]:</b> ' : '';
  embeddedNode.innerHTML = badge + renderFormattedText(text, variant, containerId);

  embeddedNode.addEventListener('click', (e) => {
    e.stopPropagation();
    setSelected(embeddedNode);
  });

  embeddedNode.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    editingTarget = embeddedNode;
    targetContainerGroup.style.display = 'none';
    contentGroup.style.display = 'block';
    variantGroup.style.display = 'block';
    variantSelect.value = embeddedNode.dataset.variant || 'string';
    inputContainer.innerHTML = `<textarea id="textContent">${embeddedNode.dataset.rawText || ''}</textarea>`;
    modal.style.display = 'flex';
  });

  container.appendChild(embeddedNode);
  refreshContainerLists(container);
  updateConnections();

  // Auto-generate the group container + option slots when an ordered/unordered
  // list is embedded directly via drag-and-drop (not just via the edit modal)
  if (container.dataset.type === 'container' && (variant === 'ordered' || variant === 'unordered')) {
    autoGenerateGroupAndMenusForContainer(container, text, variant);
  }

  saveCanvasState();
  return embeddedNode;
}

function createNode(type, x, y, customContainerId = null) {
  const node = document.createElement('div');
  node.className = 'node';
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.dataset.type = type;
  node.dataset.variant = 'string';
  node.dataset.nodeId = Math.random().toString(36).substr(2, 9);

  let defaultText = type.toUpperCase();
  let badgeHTML = '';

  if (type === 'start') {
    defaultText = '*123#';
  } else if (type === 'container') {
    const assignedId = customContainerId !== null ? customContainerId : String(containerCounter);
    node.dataset.containerId = assignedId;
    defaultText = `Menu ${assignedId}`;
    badgeHTML = `<div class="container-id-badge">ID: ${assignedId}</div>
                 <svg class="container-port-in" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-in"/></svg>
                 <svg class="container-port-out" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-out" data-port="out"/></svg>`;
    if (customContainerId === null) containerCounter++;
  } else if (type === 'group-container') {
    defaultText = 'Group Container';
    badgeHTML = `<svg class="container-port-in" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-in"/></svg>
                 <svg class="container-port-out" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-out" data-port="out"/></svg>`;
  } else if (type === 'goto') {
    const containers = document.querySelectorAll('.node[data-type="container"]');
    const targetId = containers.length > 0 ? containers[0].dataset.containerId : 1;
    node.dataset.targetContainerId = targetId;
    defaultText = `GOTO -> ID: ${targetId}`;
  } else if (type === 'text') {
    defaultText = 'Option A\nOption B';
  } else if (type === 'input') {
    defaultText = 'User Input Field';
  }

  node.dataset.rawText = defaultText;

  let width = 140, height = 80;
  let svgShape = '';

  switch (type) {
    case 'start':
      width = 70; height = 70;
      svgShape = `<svg viewBox="0 0 70 70" preserveAspectRatio="none"><circle cx="35" cy="35" r="30" class="shape-start"/><circle cx="65" cy="35" r="4" class="port port-out" data-port="out"/></svg>`;
      break;

    case 'text':
      width = 130; height = 60;
      svgShape = `<svg viewBox="0 0 130 60" preserveAspectRatio="none"><rect x="5" y="5" width="120" height="50" rx="8" class="shape-text"/></svg>`;
      break;

    case 'input':
      width = 140; height = 70;
      svgShape = `<svg viewBox="0 0 140 70" preserveAspectRatio="none"><rect x="5" y="5" width="130" height="60" rx="18" class="shape-input"/></svg>`;
      break;

    case 'action':
      width = 140; height = 80;
      svgShape = `
        <svg viewBox="0 0 140 80" preserveAspectRatio="none">
          <polygon points="25,5 115,5 135,40 115,75 25,75 5,40" class="shape-action"/>
          <circle cx="5" cy="40" r="4" class="port port-in"/>

          <text x="110" y="22" class="port-label port-label-true">TRUE</text>
          <circle cx="135" cy="22" r="4" class="port port-out port-true" data-port="out-true"/>

          <text x="106" y="58" class="port-label port-label-false">FALSE</text>
          <circle cx="135" cy="58" r="4" class="port port-out port-false" data-port="out-false"/>
        </svg>`;
      break;

    case 'goto':
      width = 100; height = 90;
      svgShape = `<svg viewBox="0 0 100 90" preserveAspectRatio="none"><polygon points="50,5 95,45 50,85 5,45" class="shape-goto"/><circle cx="5" cy="45" r="4" class="port port-in"/><circle cx="95" cy="45" r="4" class="port port-out" data-port="out"/></svg>`;
      break;

    case 'end':
      width = 70; height = 70;
      svgShape = `<svg viewBox="0 0 70 70" preserveAspectRatio="none"><polygon points="35,5 65,60 5,60" class="shape-end"/><circle cx="35" cy="5" r="4" class="port port-in"/></svg>`;
      break;
  }

  if (type !== 'container' && type !== 'group-container') {
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    node.innerHTML = `
      ${svgShape}
      <div class="node-text-container" style="position: absolute; inset: 0;">
        ${renderFormattedText(node.dataset.rawText, node.dataset.variant)}
      </div>
    `;
  } else {
    node.innerHTML = `
      ${badgeHTML}
      <div class="node-title" style="font-size: 11px; font-weight: 700; color: #1e293b; text-align: center;">${defaultText}</div>
    `;
  }

  resizeObserver.observe(node);

  node.querySelectorAll('.port-out').forEach(portEl => {
    portEl.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelPendingConnection();
      pendingConnection = {
        fromNode: node,
        portType: portEl.dataset.port || 'out',
        portEl: portEl
      };
      portEl.classList.add('port-active');
    });
  });

  node.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('embedded-node') || e.target.classList.contains('port') || e.target.classList.contains('option-badge')) return;

    if (pendingConnection && pendingConnection.fromNode !== node) {
      connections = connections.filter(c => !(c.fromNode === pendingConnection.fromNode && c.portType === pendingConnection.portType));

      connections.push({
        fromNode: pendingConnection.fromNode,
        toNode: node,
        portType: pendingConnection.portType
      });

      cancelPendingConnection();
      updateConnections();
      saveCanvasState();
      return;
    }

    setSelected(node);

    if (type === 'goto') {
      highlightTargetContainer(node.dataset.targetContainerId);
    }

    const rect = node.getBoundingClientRect();
    if (e.clientX > rect.right - 16 && e.clientY > rect.bottom - 16) return;

    activeNode = node;
    initialPosition = { x: node.offsetLeft, y: node.offsetTop };
    const worldPos = screenToWorld(e.clientX, e.clientY);
    offset.x = worldPos.x - node.offsetLeft;
    offset.y = worldPos.y - node.offsetTop;
    node.style.zIndex = 1000;
  });

  node.addEventListener('dblclick', (e) => {
    if (e.target.classList.contains('embedded-node') || e.target.classList.contains('port') || e.target.classList.contains('option-badge')) return;

    editingTarget = node;
    contentGroup.style.display = 'block';

    if (type === 'goto') {
      variantGroup.style.display = 'none';
      targetContainerGroup.style.display = 'block';

      const containers = document.querySelectorAll('.node[data-type="container"]');
      containerSelect.innerHTML = '';
      containers.forEach(c => {
        const cId = c.dataset.containerId;
        const cTitle = c.querySelector('.node-title')?.textContent || 'Container';
        const opt = document.createElement('option');
        opt.value = cId;
        opt.textContent = `ID ${cId}: ${cTitle}`;
        if (cId === node.dataset.targetContainerId) opt.selected = true;
        containerSelect.appendChild(opt);
      });

      inputContainer.innerHTML = `<input type="text" id="textContent" value="${node.dataset.rawText || ''}">`;
    } else {
      variantGroup.style.display = (type === 'text' || type === 'input' || type === 'container') ? 'block' : 'none';
      targetContainerGroup.style.display = 'none';
      variantSelect.value = node.dataset.variant || 'string';
      inputContainer.innerHTML = `<textarea id="textContent">${node.dataset.rawText || ''}</textarea>`;
    }
    modal.style.display = 'flex';
  });

  world.appendChild(node);
  nodesList.push(node);
  saveCanvasState();
  return node;
}

/* Walks up the offsetParent chain to get a node's true position in world space,
   whether it sits directly in `world` or is nested inside a group-container. */
function getNodeWorldPosition(node) {
  let x = 0, y = 0;
  let el = node;
  while (el && el !== world) {
    x += el.offsetLeft;
    y += el.offsetTop;
    el = el.offsetParent;
  }
  return { x, y };
}

function getPortCoordinates(node, portType) {
  const pos = getNodeWorldPosition(node);
  const x = pos.x;
  const y = pos.y;
  const w = node.offsetWidth;
  const h = node.offsetHeight;

  if (portType === 'out-true') {
    return { x: x + w, y: y + (h * 0.275) };
  } else if (portType === 'out-false') {
    return { x: x + w, y: y + (h * 0.725) };
  } else if (portType === 'out') {
    return { x: x + w, y: y + h / 2 };
  } else {
    return { x: x, y: y + h / 2 };
  }
}

function updateConnections() {
  const defs = svgCanvas.querySelector('defs');
  svgCanvas.innerHTML = '';
  svgCanvas.appendChild(defs);

  connections.forEach(conn => {
    const start = getPortCoordinates(conn.fromNode, conn.portType || 'out');
    const end = getPortCoordinates(conn.toNode, 'in');

    const dx = Math.abs(end.x - start.x) / 2;
    const d = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);

    let strokeClass = 'connection-line';
    let marker = 'url(#arrow)';

    if (conn.portType === 'out-true') {
      strokeClass += ' true-line';
      marker = 'url(#arrow-true)';
    } else if (conn.portType === 'out-false') {
      strokeClass += ' false-line';
      marker = 'url(#arrow-false)';
    }

    path.setAttribute('class', strokeClass);
    path.setAttribute('marker-end', marker);
    svgCanvas.appendChild(path);
  });
}

function deleteSelectedElement() {
  if (!selectedElement) return;

  if (selectedElement.classList.contains('embedded-node')) {
    const parentContainer = findParentContainer(selectedElement);
    selectedElement.remove();
    if (parentContainer) refreshContainerLists(parentContainer);
  } else if (selectedElement.classList.contains('node')) {
    const nodeToDelete = selectedElement;

    if (lastDroppedNode === nodeToDelete) {
      lastDroppedNode = null;
    }

    const inConns = connections.filter(c => c.toNode === nodeToDelete);
    const outConns = connections.filter(c => c.fromNode === nodeToDelete);

    inConns.forEach(inConn => {
      outConns.forEach(outConn => {
        connections.push({
          fromNode: inConn.fromNode,
          toNode: outConn.toNode,
          portType: inConn.portType
        });
      });
    });

    connections = connections.filter(conn => conn.fromNode !== nodeToDelete && conn.toNode !== nodeToDelete);
    nodesList = nodesList.filter(n => n !== nodeToDelete);

    nodeToDelete.remove();
    updateConnections();
  }
  selectedElement = null;
  saveCanvasState();
}

btnSave.addEventListener('click', () => {
  if (editingTarget) {
    const textInput = document.getElementById('textContent');
    const selectedVariant = variantSelect.value;
    const rawTextValue = textInput.value;

    if (editingTarget.classList.contains('embedded-node')) {
      editingTarget.dataset.variant = selectedVariant;
      editingTarget.dataset.rawText = rawTextValue;

      const parentContainer = findParentContainer(editingTarget);
      const containerId = parentContainer ? parentContainer.dataset.containerId : null;
      const badge = editingTarget.dataset.type === 'input' ? '<b>[Input]:</b> ' : '';
      editingTarget.innerHTML = badge + renderFormattedText(editingTarget.dataset.rawText, editingTarget.dataset.variant, containerId);

      // Auto-generate group container & child menus when list is saved in embedded node
      if (parentContainer) {
        autoGenerateGroupAndMenusForContainer(parentContainer, rawTextValue, selectedVariant);
      }

    } else if (editingTarget.dataset.type === 'goto') {
      const selectedId = containerSelect.value;
      editingTarget.dataset.targetContainerId = selectedId;
      editingTarget.dataset.rawText = `GOTO -> ID: ${selectedId}`;
      const container = editingTarget.querySelector('.node-text-container');
      if (container) container.innerHTML = renderFormattedText(editingTarget.dataset.rawText, 'string');

    } else {
      editingTarget.dataset.variant = selectedVariant;
      editingTarget.dataset.rawText = rawTextValue;

      if (editingTarget.dataset.type === 'container') {
        const titleEl = editingTarget.querySelector('.node-title');
        if (titleEl) titleEl.textContent = `Menu ${editingTarget.dataset.containerId}`;
        refreshContainerLists(editingTarget);

        // Auto-generate group container & child menus when list is set directly on Container
        autoGenerateGroupAndMenusForContainer(editingTarget, rawTextValue, selectedVariant);
      } else {
        const container = editingTarget.querySelector('.node-text-container');
        if (container) container.innerHTML = renderFormattedText(editingTarget.dataset.rawText, editingTarget.dataset.variant);
      }
    }
  }
  modal.style.display = 'none';
  editingTarget = null;
  saveCanvasState();
});

btnCancel.addEventListener('click', () => {
  modal.style.display = 'none';
  editingTarget = null;
});

document.addEventListener('mousemove', (e) => {
  if (!activeNode) return;
  const worldPos = screenToWorld(e.clientX, e.clientY);
  activeNode.style.left = `${worldPos.x - offset.x}px`;
  activeNode.style.top = `${worldPos.y - offset.y}px`;
  updateConnections();
});

document.addEventListener('mouseup', (e) => {
  if (activeNode) {
    const nodeType = activeNode.dataset.type;

    if (nodeType === 'text' || nodeType === 'input') {
      const targetContainer = findContainerAtPoint(e.clientX, e.clientY, activeNode);
      if (targetContainer && targetContainer.dataset.type === 'container') {
        addEmbeddedNodeToContainer(
          targetContainer,
          nodeType,
          activeNode.dataset.rawText,
          activeNode.dataset.variant || 'string'
        );

        nodesList = nodesList.filter(n => n !== activeNode);
        if (lastDroppedNode === activeNode) lastDroppedNode = null;
        activeNode.remove();
        activeNode = null;
        updateConnections();
        saveCanvasState();
        return;
      }
    }

    const newPos = { x: activeNode.offsetLeft, y: activeNode.offsetTop };
    if (initialPosition.x !== newPos.x || initialPosition.y !== newPos.y) {
      undoStack.push({
        node: activeNode,
        oldPos: { ...initialPosition },
        newPos: { ...newPos }
      });
    }
    activeNode.style.zIndex = 2;
    activeNode = null;
    saveCanvasState();
  }
});

/* Keyboard Shortcuts */
document.addEventListener('keydown', (e) => {
  if (modal.style.display === 'flex') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelectedElement();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (undoStack.length > 0) {
      const lastAction = undoStack.pop();
      lastAction.node.style.left = `${lastAction.oldPos.x}px`;
      lastAction.node.style.top = `${lastAction.oldPos.y}px`;
      updateConnections();
      saveCanvasState();
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  loadCanvasState();
});