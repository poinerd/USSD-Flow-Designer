
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

    // Pan / Zoom State
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let spacePressed = false;
    let startPan = { x: 0, y: 0 };

    // Canvas State
    let draggedType = null;
    let activeNode = null;
    let selectedElement = null;
    let initialPosition = { x: 0, y: 0 };
    let editingTarget = null;
    let offset = { x: 0, y: 0 };
    
    let containerCounter = 1;
    let nodesList = [];
    let connections = [];
    let undoStack = [];
    
    // Explicit tracking of the last dropped flow node for auto-connection
    let lastDroppedNode = null;

    // Pending Manual Connection State
    let pendingConnection = null;

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

    // Key Listeners for Pan
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

    canvas.addEventListener('dragover', (e) => e.preventDefault());

    canvas.addEventListener('click', (e) => {
      if (e.target === canvas || e.target === world || e.target === svgCanvas) {
        clearSelection();
        cancelPendingConnection();
      }
    });

    /* Drop Handler with Sequential Auto-Connect Logic */
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedType) return;

      const worldPos = screenToWorld(e.clientX, e.clientY);
      const targetContainer = findContainerAtPoint(e.clientX, e.clientY, null);

      // Embed standalone text or input nodes if dropped inside a container
      if ((draggedType === 'text' || draggedType === 'input') && targetContainer) {
        const defaultText = draggedType === 'text' ? 'Sample Text' : 'User Input Variable';
        addEmbeddedNodeToContainer(targetContainer, draggedType, defaultText);
        draggedType = null;
        return;
      }

      // Create new flow node
      const newNode = createNode(draggedType, worldPos.x - 50, worldPos.y - 30);

      // Auto-connect sequentially to the previously dropped node
      if (draggedType !== 'text' && draggedType !== 'input') {
        if (lastDroppedNode && lastDroppedNode.dataset.type !== 'end' && newNode.dataset.type !== 'start') {
          let portType = 'out';
          let targetNodeForNextConnection = newNode;
          
          if (lastDroppedNode.dataset.type === 'action') {
            const hasTrueConn = connections.some(c => c.fromNode === lastDroppedNode && c.portType === 'out-true');
            const hasFalseConn = connections.some(c => c.fromNode === lastDroppedNode && c.portType === 'out-false');

            if (!hasTrueConn) {
              portType = 'out-true';
            } else if (!hasFalseConn) {
              portType = 'out-false';
              // If we connected both True and False, don't update lastDroppedNode to this false branch node, keep chain linear
              const trueConn = connections.find(c => c.fromNode === lastDroppedNode && c.portType === 'out-true');
              targetNodeForNextConnection = trueConn ? trueConn.toNode : newNode;
            }
          }

          // Push auto connection if port is open
          const isPortOccupied = connections.some(c => c.fromNode === lastDroppedNode && c.portType === portType);
          if (!isPortOccupied) {
            connections.push({ fromNode: lastDroppedNode, toNode: newNode, portType: portType });
            updateConnections();
          }

          lastDroppedNode = targetNodeForNextConnection;
        } else {
          lastDroppedNode = newNode;
        }
      }

      draggedType = null;
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
      const containers = Array.from(document.querySelectorAll('.node[data-type="container"]'));
      return containers.find(c => {
        if (c === excludeNode) return false;
        const r = c.getBoundingClientRect();
        return screenX >= r.left && screenX <= r.right && screenY >= r.top && screenY <= r.bottom;
      });
    }

    function renderFormattedText(text, variant) {
      if (!text || text.trim() === '') return '';
      const lines = text.split('\n').filter(line => line.trim() !== '');

      if (variant === 'ordered') {
        return `<ol>${lines.map(line => `<li>${line}</li>`).join('')}</ol>`;
      } else if (variant === 'unordered') {
        return `<ul>${lines.map(line => `<li>${line}</li>`).join('')}</ul>`;
      } else {
        return `<div>${lines.join('<br>')}</div>`;
      }
    }

    function addEmbeddedNodeToContainer(container, type, text, variant = 'string') {
      const embeddedNode = document.createElement('div');
      embeddedNode.className = 'embedded-node';
      embeddedNode.dataset.type = type;
      embeddedNode.dataset.rawText = text;
      embeddedNode.dataset.variant = variant;
      
      const badge = type === 'input' ? '<b>[Input]:</b> ' : '';
      embeddedNode.innerHTML = badge + renderFormattedText(text, variant);

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
      updateConnections();
    }

    function createNode(type, x, y) {
      const node = document.createElement('div');
      node.className = 'node';
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.dataset.type = type;
      node.dataset.variant = 'string';

      let defaultText = type.toUpperCase();
      let badgeHTML = '';

      if (type === 'start') {
        defaultText = '*123#';
      } else if (type === 'container') {
        defaultText = 'Main Menu';
        node.dataset.containerId = containerCounter;
        badgeHTML = `<div class="container-id-badge">ID: ${containerCounter}</div>
                     <svg class="container-port-in" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-in"/></svg>
                     <svg class="container-port-out" width="10" height="10"><circle cx="5" cy="5" r="4" class="port port-out" data-port="out"/></svg>`;
        containerCounter++;
      } else if (type === 'goto') {
        const containers = document.querySelectorAll('.node[data-type="container"]');
        const targetId = containers.length > 0 ? containers[0].dataset.containerId : 1;
        node.dataset.targetContainerId = targetId;
        defaultText = `GOTO -> ID: ${targetId}`;
      } else if (type === 'text') {
        defaultText = 'Standalone Text Block';
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

      if (type !== 'container') {
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

      // Port click listener for manual links
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
        if (e.target.classList.contains('embedded-node') || e.target.classList.contains('port')) return;

        // Complete manual link when clicking target node
        if (pendingConnection && pendingConnection.fromNode !== node) {
          // Remove existing connection ONLY for the specific port clicked (preserves true when false is created)
          connections = connections.filter(c => !(c.fromNode === pendingConnection.fromNode && c.portType === pendingConnection.portType));
          
          connections.push({
            fromNode: pendingConnection.fromNode,
            toNode: node,
            portType: pendingConnection.portType
          });
          
          cancelPendingConnection();
          updateConnections();
          return;
        }

        setSelected(node);

        if (type === 'goto') {
          const targetId = node.dataset.targetContainerId;
          const targetContainer = document.querySelector(`.node[data-container-id="${targetId}"]`);
          if (targetContainer) {
            targetContainer.classList.add('target-highlight');
            setTimeout(() => targetContainer.classList.remove('target-highlight'), 2500);
          }
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
        if (e.target.classList.contains('embedded-node') || e.target.classList.contains('port')) return;

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
          variantGroup.style.display = (type === 'text' || type === 'input') ? 'block' : 'none';
          targetContainerGroup.style.display = 'none';
          variantSelect.value = node.dataset.variant || 'string';
          inputContainer.innerHTML = `<textarea id="textContent">${node.dataset.rawText || ''}</textarea>`;
        }
        modal.style.display = 'flex';
      });

      world.appendChild(node);
      nodesList.push(node);
      return node;
    }

    function getPortCoordinates(node, portType) {
      const x = node.offsetLeft;
      const y = node.offsetTop;
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
        selectedElement.remove();
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
    }

    btnSave.addEventListener('click', () => {
      if (editingTarget) {
        const textInput = document.getElementById('textContent');
        
        if (editingTarget.classList.contains('embedded-node')) {
          editingTarget.dataset.variant = variantSelect.value;
          editingTarget.dataset.rawText = textInput.value;
          const badge = editingTarget.dataset.type === 'input' ? '<b>[Input]:</b> ' : '';
          editingTarget.innerHTML = badge + renderFormattedText(editingTarget.dataset.rawText, editingTarget.dataset.variant);
        } else if (editingTarget.dataset.type === 'goto') {
          const selectedId = containerSelect.value;
          editingTarget.dataset.targetContainerId = selectedId;
          editingTarget.dataset.rawText = `GOTO -> ID: ${selectedId}`;
          const container = editingTarget.querySelector('.node-text-container');
          if (container) container.innerHTML = renderFormattedText(editingTarget.dataset.rawText, 'string');
        } else {
          editingTarget.dataset.variant = variantSelect.value;
          editingTarget.dataset.rawText = textInput.value;
          if (editingTarget.dataset.type === 'container') {
            const titleEl = editingTarget.querySelector('.node-title');
            if (titleEl) titleEl.textContent = textInput.value;
          } else {
            const container = editingTarget.querySelector('.node-text-container');
            if (container) container.innerHTML = renderFormattedText(editingTarget.dataset.rawText, editingTarget.dataset.variant);
          }
        }
      }
      modal.style.display = 'none';
      editingTarget = null;
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
          if (targetContainer) {
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
        }
      }
    });