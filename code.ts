// Utility: find or cache the "📝 Annotations" main group on the current page
async function getMainGroup(): Promise<GroupNode | null> {
  const cachedId = figma.currentPage.getPluginData("mainGroupId");
  if (cachedId) {
    try {
      const node = await figma.getNodeByIdAsync(cachedId);
      if (node.type === "GROUP" && node.name === "📝 Annotations") {
        return node as GroupNode;
      }
    } catch {
      // invalid cache
    }
  }
  for (const node of figma.currentPage.children) {
    if (node.type === "GROUP" && node.name === "📝 Annotations") {
      figma.currentPage.setPluginData("mainGroupId", node.id);
      return node as GroupNode;
    }
  }
  return null;
}

// Utility: get the outermost frame ancestor of a node
function getOutermostFrame(node: SceneNode): FrameNode | null {
  let current: BaseNode | null = node;
  let outer: FrameNode | null = null;
  while (current && current.parent && current.parent.type !== "PAGE") {
    if (current.parent.type === "FRAME") outer = current.parent as FrameNode;
    current = current.parent;
  }
  return outer;
}

type Direction = 'left' | 'right' | 'top' | 'bottom';

// 計算 gap 與方向
function calculateGapAndDirection(node: SceneNode) {
  const abs = node.absoluteTransform;
  const x = abs[0][2], y = abs[1][2];
  const outer = getOutermostFrame(node);
  const leftBound = outer ? outer.absoluteTransform[0][2] : 0;
  const topBound = outer ? outer.absoluteTransform[1][2] : 0;
  const rightBound = outer ? leftBound + outer.width : figma.currentPage.width;
  const bottomBound = outer ? topBound + outer.height : figma.currentPage.height;
  const gapLeft = x - leftBound;
  const gapRight = rightBound - (x + node.width);
  const gapTop = y - topBound;
  const gapBottom = bottomBound - (y + node.height);
  const gaps = [
    { dir: "left", value: gapLeft },
    { dir: "right", value: gapRight },
    { dir: "top", value: gapTop },
    { dir: "bottom", value: gapBottom }
  ];
  gaps.sort((a, b) => a.value - b.value);
  const minDir = gaps[0].dir as Direction;
  const minGap = gaps[0].value;
  return { minDir, minGap, x, y, gapLeft, gapRight, gapTop, gapBottom };
}

// 建立標註 group
function createAnnotationGroup(node: SceneNode, labelFrame: FrameNode, uuid: string) {
  const { minDir, minGap, x, y, gapLeft, gapRight, gapTop, gapBottom } = calculateGapAndDirection(node);
  const labelPadding = 66;
  let lineLength = Math.max(minGap + labelPadding, 60);

  // --- Create vector and circle ---
  const circle = figma.createEllipse();
  circle.resize(6, 6);
  circle.fills = [{ type: 'SOLID', color: { r: 0.32, g: 0.67, b: 0.40 } }];
  circle.strokes = [];

  const groupFrame = figma.createFrame();
  groupFrame.name = "icon-naming-card";
  groupFrame.primaryAxisSizingMode = "AUTO";
  groupFrame.counterAxisSizingMode = "AUTO";
  groupFrame.itemSpacing = 0;
  groupFrame.fills = [];
  groupFrame.primaryAxisAlignItems = "CENTER";
  groupFrame.counterAxisAlignItems = "CENTER";

  const vector = figma.createVector();
  vector.strokeWeight = 2;
  vector.strokes = [{ type: 'SOLID', color: { r: 0.32, g: 0.67, b: 0.40 } }];
  vector.strokeCap = "NONE";
  vector.dashPattern = [4, 4];

  if (minDir === "right") {
    groupFrame.layoutMode = "HORIZONTAL";
    lineLength = Math.max(gapRight + labelPadding, 60);
    vector.resize(lineLength, 2);
    vector.vectorPaths = [{ data: `M 0 1 L ${lineLength} 1`, windingRule: "NONZERO" }];
    groupFrame.primaryAxisAlignItems = "MIN";
    groupFrame.appendChild(circle);
    groupFrame.appendChild(vector);
    groupFrame.appendChild(labelFrame);
  } else if (minDir === "left") {
    groupFrame.layoutMode = "HORIZONTAL";
    lineLength = Math.max(gapLeft + labelPadding, 60);
    vector.resize(lineLength, 2);
    vector.vectorPaths = [{ data: `M ${lineLength} 1 L 0 1`, windingRule: "NONZERO" }];
    groupFrame.primaryAxisAlignItems = "MAX";
    groupFrame.appendChild(labelFrame);
    groupFrame.appendChild(vector);
    groupFrame.appendChild(circle);
  } else if (minDir === "top") {
    groupFrame.layoutMode = "VERTICAL";
    lineLength = Math.max(gapTop + labelPadding, 60);
    vector.resize(2, lineLength);
    vector.vectorPaths = [{ data: `M 1 0 L 1 ${lineLength}`, windingRule: "NONZERO" }];
    groupFrame.primaryAxisAlignItems = "CENTER";
    groupFrame.appendChild(labelFrame);
    groupFrame.appendChild(vector);
    groupFrame.appendChild(circle);
  } else {
    groupFrame.layoutMode = "VERTICAL";
    lineLength = Math.max(gapBottom + labelPadding, 60);
    vector.resize(2, lineLength);
    vector.vectorPaths = [{ data: `M 1 ${lineLength} L 1 0`, windingRule: "NONZERO" }];
    groupFrame.primaryAxisAlignItems = "CENTER";
    groupFrame.appendChild(circle);
    groupFrame.appendChild(vector);
    groupFrame.appendChild(labelFrame);
  }

  // --- Positioning ---
  const groupXMap: any = {
    right: x + node.width,
    left: x - groupFrame.width,
    top: x + node.width / 2 - groupFrame.width / 2,
    bottom: x + node.width / 2 - groupFrame.width / 2
  };
  const groupYMap: any = {
    right: y + node.height / 2 - groupFrame.height / 2,
    left: y + node.height / 2 - groupFrame.height / 2,
    top: y - groupFrame.height,
    bottom: y + node.height
  };
  groupFrame.x = 0; groupFrame.y = 0;
  const wrapper = figma.group([groupFrame], figma.currentPage);
  wrapper.name = `iconAnnotation-${uuid}`;
  wrapper.x = groupXMap[minDir];
  wrapper.y = groupYMap[minDir];
  wrapper.locked = true;
  wrapper.setPluginData("targetId", node.id);
  wrapper.setPluginData("uuid", uuid);
  return wrapper;
}

async function main() {
  const command = figma.command;

  if (command === 'annotate') {
    const selection = figma.currentPage.selection;
    if (!selection.length) {
      figma.closePlugin('Please select one or more icons.');
      return;
    }
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Medium' });
    let mainGroup = await getMainGroup();
    const wrappers: GroupNode[] = [];

    for (const icon of selection) {
      let originalName = icon.name;
      // validate prefix depending on node type
      if (icon.type === 'INSTANCE') {
        let comp: ComponentNode | null = null;
        try { comp = await (icon as InstanceNode).getMainComponentAsync(); } catch {}
        if (!comp || !/^(ic_|ig_|img_|icon_)/i.test(comp.name)) {
          figma.notify('Instance corresponding component must start with ic_/ig_/img_/icon_.', { error: true });
          continue;
        }
        originalName = comp.name;
      } else if (icon.type === 'COMPONENT') {
        if (!/^(ic_|ig_|img_|icon_)/i.test(icon.name)) {
          figma.notify('Component name must start with ic_/ig_/img_/icon_.', { error: true });
          continue;
        }
      } else {
        if (!/^(ic_|ig_|img_|icon_)/i.test(icon.name)) {
          figma.notify('Layer name must start with ic_/ig_/img_/icon_.', { error: true });
          continue;
        }
      }

      const uuid = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

      // --- Create labelFrame ---
      const labelFrame = figma.createFrame();
      labelFrame.layoutMode = 'HORIZONTAL';
      labelFrame.primaryAxisSizingMode = 'AUTO';
      labelFrame.counterAxisSizingMode = 'AUTO';
      labelFrame.paddingLeft = 8; labelFrame.paddingRight = 8;
      labelFrame.paddingTop = 4; labelFrame.paddingBottom = 4;
      labelFrame.cornerRadius = 2;
      labelFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      labelFrame.strokes = [{ type: 'SOLID', color: { r: 0.32, g: 0.67, b: 0.40 } }];
      labelFrame.strokeWeight = 2;
      labelFrame.primaryAxisAlignItems = 'CENTER';
      labelFrame.counterAxisAlignItems = 'CENTER';
      const text = figma.createText();
      text.fontName = { family: 'DM Mono', style: 'Medium' };
      text.fontSize = 16;
      text.characters = originalName;
      labelFrame.appendChild(text);

      // --- Create annotation group ---
      const wrapper = createAnnotationGroup(icon, labelFrame, uuid);
      wrapper.setPluginData('iconId', icon.id);
      icon.name = `${originalName}-${uuid}`;
      wrappers.push(wrapper);
    }

    if (wrappers.length === 0) { figma.closePlugin('No icons annotated, please check naming.'); return; }
    if (!mainGroup) {
      mainGroup = figma.group(wrappers, figma.currentPage);
      mainGroup.name = '📝 Annotations'; mainGroup.locked = true;
    } else {
      mainGroup.locked = false;
      for (const w of wrappers) mainGroup.appendChild(w);
      mainGroup.locked = true;
    }
    figma.currentPage.appendChild(mainGroup);
    figma.currentPage.selection = wrappers;
    figma.closePlugin('Annotated icons successfully.');

  } else if (command === 'realign') {
    let mainGroup = await getMainGroup();
    if (!mainGroup) { figma.closePlugin("can't find main group."); return; }
    mainGroup.locked = false;
    let realigned = 0, removed = 0;
    for (const wrapper of [...mainGroup.children] as GroupNode[]) {
      if (!wrapper.name.startsWith('iconAnnotation-')) continue;
      const iconId = wrapper.getPluginData('iconId');
      let icon: SceneNode | null = null;
      try { icon = await figma.getNodeByIdAsync(iconId) as SceneNode; } catch { }
      if (!icon) { try { wrapper.remove(); } catch {} removed++; continue; }

      // 只移動 group，不重建
      const frame = wrapper.findOne(n => n.type === "FRAME" && n.name === "icon-naming-card") as FrameNode;
      if (!frame) continue;
      const abs = icon.absoluteTransform;
      const x = abs[0][2], y = abs[1][2];
      const w = icon.width, h = icon.height;
      const outer = getOutermostFrame(icon);
      const leftBound = outer ? outer.absoluteTransform[0][2] : 0;
      const topBound = outer ? outer.absoluteTransform[1][2] : 0;
      const rightBound = outer ? leftBound + outer.width : figma.currentPage.width;
      const bottomBound = outer ? topBound + outer.height : figma.currentPage.height;
      const gaps = {
        left: x - leftBound,
        right: rightBound - (x + w),
        top: y - topBound,
        bottom: bottomBound - (y + h)
      };
      const dir = (Object.entries(gaps).sort((a, b) => a[1] - b[1])[0][0]) as Direction;
      const positions: any = {
        right: { x: x + w, y: y + h / 2 - frame.height / 2 },
        left:  { x: x - frame.width, y: y + h / 2 - frame.height / 2 },
        top:   { x: x + w / 2 - frame.width / 2, y: y - frame.height },
        bottom:{ x: x + w / 2 - frame.width / 2, y: y + h }
      };
      wrapper.x = positions[dir].x;
      wrapper.y = positions[dir].y;
      realigned++;
    }
    figma.currentPage.appendChild(mainGroup); mainGroup.locked = true;
    figma.closePlugin(`Re-aligned ${realigned} annotations, removed ${removed} invalid annotations.`);
  } else { figma.closePlugin(); }
}

main();
