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

// 檢查節點及其子節點是否有漸層色或圖片 fill
function hasGradientOrImageFill(node: SceneNode): boolean {
  // 檢查當前節點的 fills
  if ('fills' in node && node.fills && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (fill.type === 'GRADIENT_LINEAR' || 
          fill.type === 'GRADIENT_RADIAL' || 
          fill.type === 'GRADIENT_ANGULAR' || 
          fill.type === 'GRADIENT_DIAMOND' ||
          fill.type === 'IMAGE') {
        return true;
      }
    }
  }
  // 檢查當前節點的 effects
  if ('effects' in node && node.effects && Array.isArray(node.effects)) {
    for (const effect of node.effects) {
      if (effect.visible !== false && 
          (effect.type === 'DROP_SHADOW' || 
           effect.type === 'INNER_SHADOW' || 
           effect.type === 'LAYER_BLUR' || 
           effect.type === 'BACKGROUND_BLUR' ||
           effect.type === 'NOISE' ||
           effect.type === 'TEXTURE' ||
           effect.type === 'GLASS')) {
        return true;
      }
    }
  }
  // 遞歸檢查子節點
  if ('children' in node && node.children) {
    for (const child of node.children) {
      if (hasGradientOrImageFill(child as SceneNode)) {
        return true;
      }
    }
  }
  
  return false;
}

// 計算 gap 與方向
function calculateGapAndDirection(node: SceneNode) {
  const abs = node.absoluteTransform;
  const x = abs[0][2], y = abs[1][2];
  const outer = getOutermostFrame(node);

  let leftBound, topBound, rightBound, bottomBound;
  if (outer) {
    leftBound = outer.absoluteTransform[0][2];
    topBound = outer.absoluteTransform[1][2];
    rightBound = leftBound + outer.width;
    bottomBound = topBound + outer.height;
  } else {
    // 沒有 frame 父層時，直接用 icon 自己的邊界
    leftBound = x;
    topBound = y;
    rightBound = x + node.width;
    bottomBound = y + node.height;
  }

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

// 建立 GUI Style Guide Card
function createGuiStyleGuideCard(node: SceneNode): GroupNode {
  // 記錄原始位置
  const originalX = node.x;
  const originalY = node.y;
  
  // 2. File Format Tag
  const fileFormat = hasGradientOrImageFill(node) ? 'PNG' : 'SVG';
  const themeColor = fileFormat === 'PNG' ? { r: 0.996, g: 0.635, b: 0.137 } : { r: 0.32, g: 0.67, b: 0.40 };
  
  // 建立主要的 Card Frame
  const card = figma.createFrame();
  card.name = "Card";
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "AUTO";
  card.paddingLeft = 32;
  card.paddingRight = 32;
  card.paddingTop = 32;
  card.paddingBottom = 32;
  card.itemSpacing = 16;
  card.primaryAxisAlignItems = "MIN";
  card.counterAxisAlignItems = "MIN";
  
  // 背景色和邊框
  card.fills = [{ type: 'SOLID', color: themeColor, opacity: 0.2 }];
  card.strokes = [{ type: 'SOLID', color: themeColor }];
  card.strokeWeight = 4;
  card.dashPattern = [32];
  
  // 1. Icon Container
  const iconContainer = figma.createFrame();
  iconContainer.name = "icon_container";
  iconContainer.layoutMode = "HORIZONTAL";
  iconContainer.primaryAxisSizingMode = "AUTO";
  iconContainer.counterAxisSizingMode = "AUTO";
  iconContainer.minWidth = 512;
  iconContainer.minHeight = 512;
  iconContainer.primaryAxisAlignItems = "CENTER";
  iconContainer.counterAxisAlignItems = "CENTER";
  iconContainer.fills = [];
  
  // 直接把選取的物件放進 container 中
  iconContainer.appendChild(node);
  card.appendChild(iconContainer);
  
  const formatTag = figma.createFrame();
  formatTag.name = "file_format";
  formatTag.layoutMode = "HORIZONTAL";
  formatTag.primaryAxisSizingMode = "AUTO";
  formatTag.counterAxisSizingMode = "AUTO";
  formatTag.paddingLeft = 6;
  formatTag.paddingRight = 6;
  formatTag.paddingTop = 2;
  formatTag.paddingBottom = 2;
  formatTag.cornerRadius = 1;
  formatTag.fills = [{ type: 'SOLID', color: themeColor }];
  formatTag.primaryAxisAlignItems = "CENTER";
  formatTag.counterAxisAlignItems = "CENTER";
  
  const formatText = figma.createText();
  formatText.fontName = { family: 'DM Mono', style: 'Medium' };
  formatText.fontSize = 24;
  formatText.lineHeight = { value: 100, unit: 'PERCENT' };
  formatText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  formatText.characters = fileFormat;
  formatTag.appendChild(formatText);
  card.appendChild(formatTag);
  
  // 3. Icon Name
  const iconNameText = figma.createText();
  iconNameText.name = "icon_name";
  iconNameText.fontName = { family: 'DM Mono', style: 'Medium' };
  iconNameText.fontSize = 24;
  iconNameText.lineHeight = { value: 120, unit: 'PERCENT' };
  iconNameText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  iconNameText.characters = node.name;
  card.appendChild(iconNameText);
  
  // 4. Usage Description
  const usageText = figma.createText();
  usageText.name = "usage_desc";
  usageText.fontName = { family: 'DM Mono', style: 'Regular' };
  usageText.fontSize = 24;
  usageText.lineHeight = { value: 120, unit: 'PERCENT' };
  usageText.fills = [{ type: 'SOLID', color: { r: 0.47, g: 0.47, b: 0.47 } }];
  
  // 檢查是否為 component 並且有 description
  let usageDescription = "Please add the usage description...";
  if (node.type === 'COMPONENT' && node.description && node.description.trim() !== '') {
    usageDescription = node.description;
  }
  usageText.characters = usageDescription;
  card.appendChild(usageText);
  
  // Set layout properties after adding to auto-layout frame
  iconNameText.layoutSizingHorizontal = "FILL";
  iconNameText.layoutSizingVertical = "HUG";
  usageText.layoutSizingHorizontal = "FILL";
  usageText.layoutSizingVertical = "HUG";
  
  // 包裝成 group
  const wrapper = figma.group([card], figma.currentPage);
  wrapper.name = "Icon Style Guide";
  
  // 設定 wrapper 位置為原始物件的位置
  wrapper.x = originalX;
  wrapper.y = originalY;
  
  return wrapper;
}

// 建立 Icon Style Guide Card
function createIconStyleGuideCard(node: SceneNode): GroupNode {
  // 記錄原始位置
  const originalX = node.x;
  const originalY = node.y;
  
  // 2. File Format Tag
  const fileFormat = hasGradientOrImageFill(node) ? 'PNG' : 'SVG';
  const themeColor = fileFormat === 'PNG' ? { r: 0.996, g: 0.635, b: 0.137 } : { r: 0.32, g: 0.67, b: 0.40 };
  
  // 建立主要的 Card Frame
  const card = figma.createFrame();
  card.name = "Card";
  card.layoutMode = "HORIZONTAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "AUTO";
  card.paddingLeft = 8;
  card.paddingRight = 24;
  card.paddingTop = 8;
  card.paddingBottom = 8;
  card.itemSpacing = 16;
  card.primaryAxisAlignItems = "CENTER";
  card.counterAxisAlignItems = "CENTER";
  card.cornerRadius = 16;
  
  // 背景色和邊框
  card.fills = [{ type: 'SOLID', color: themeColor, opacity: 0.2 }];
  card.strokes = [{ type: 'SOLID', color: themeColor }];
  card.strokeWeight = 2;
  card.dashPattern = [8];
  
  // 1. Icon Container
  const iconContainer = figma.createFrame();
  iconContainer.name = "icon_container";
  iconContainer.layoutMode = "HORIZONTAL";
  iconContainer.primaryAxisSizingMode = "AUTO";
  iconContainer.counterAxisSizingMode = "AUTO";
  iconContainer.minWidth = 48;
  iconContainer.minHeight = 48;
  iconContainer.primaryAxisAlignItems = "CENTER";
  iconContainer.counterAxisAlignItems = "CENTER";
  iconContainer.fills = [];
  
  // 直接把選取的物件放進 container 中
  iconContainer.appendChild(node);
  card.appendChild(iconContainer);
  
  const formatTag = figma.createFrame();
  formatTag.name = "file_format";
  formatTag.layoutMode = "HORIZONTAL";
  formatTag.primaryAxisSizingMode = "AUTO";
  formatTag.counterAxisSizingMode = "AUTO";
  formatTag.paddingLeft = 6;
  formatTag.paddingRight = 6;
  formatTag.paddingTop = 2;
  formatTag.paddingBottom = 2;
  formatTag.cornerRadius = 1;
  formatTag.fills = [{ type: 'SOLID', color: themeColor }];
  formatTag.primaryAxisAlignItems = "CENTER";
  formatTag.counterAxisAlignItems = "CENTER";
  
  const formatText = figma.createText();
  formatText.fontName = { family: 'DM Mono', style: 'Medium' };
  formatText.fontSize = 12;
  formatText.lineHeight = { value: 100, unit: 'PERCENT' };
  formatText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  formatText.characters = fileFormat;
  formatTag.appendChild(formatText);
  card.appendChild(formatTag);
  
  // 3. Icon Name
  const iconNameText = figma.createText();
  iconNameText.name = "icon_name";
  iconNameText.fontName = { family: 'DM Mono', style: 'Medium' };
  iconNameText.fontSize = 16;
  iconNameText.lineHeight = { value: 120, unit: 'PERCENT' };
  iconNameText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  iconNameText.characters = node.name;
  card.appendChild(iconNameText);
  
  // Set layout properties after adding to auto-layout frame
  iconNameText.layoutSizingHorizontal = "HUG";
  iconNameText.layoutSizingVertical = "HUG";
  
  // 包裝成 group
  const wrapper = figma.group([card], figma.currentPage);
  wrapper.name = "Icon Style Guide";
  
  // 設定 wrapper 位置為原始物件的位置
  wrapper.x = originalX;
  wrapper.y = originalY;
  
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

      // 檢查是否需要顯示 PNG 或 SVG
      const fileFormat = hasGradientOrImageFill(icon) ? 'PNG' : 'SVG';

      // --- Create labelFrame ---
      const labelFrame = figma.createFrame();
      labelFrame.name = 'Label';
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
      labelFrame.itemSpacing = 4;
      
      // 建立 tag
      const tagFrame = figma.createFrame();
      tagFrame.name = 'file format';
      tagFrame.layoutMode = 'HORIZONTAL';
      tagFrame.primaryAxisSizingMode = 'AUTO';
      tagFrame.counterAxisSizingMode = 'AUTO';
      tagFrame.paddingLeft = 6; tagFrame.paddingRight = 6;
      tagFrame.paddingTop = 2; tagFrame.paddingBottom = 2;
      tagFrame.cornerRadius = 1;
      tagFrame.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.67, b: 0.4 } }];
      tagFrame.primaryAxisAlignItems = 'CENTER';
      tagFrame.counterAxisAlignItems = 'CENTER';
      
      const tagText = figma.createText();
      tagText.fontName = { family: 'DM Mono', style: 'Medium' };
      tagText.fontSize = 12;
      tagText.lineHeight = { value: 12, unit: 'PIXELS' };
      tagText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      tagText.characters = fileFormat;
      tagFrame.appendChild(tagText);
      labelFrame.appendChild(tagFrame);
      
      // 建立主要文字
      const text = figma.createText();
      text.fontName = { family: 'DM Mono', style: 'Medium' };
      text.name = 'icon-name';
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

  } else if (command === 'create-gui-style-guide') {
    const selection = figma.currentPage.selection;
    if (!selection.length) {
      figma.closePlugin('Please select one or more objects.');
      return;
    }
    
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Medium' });
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Regular' });
    
    const styleGuides: GroupNode[] = [];
    
    for (const node of selection) {
      const styleGuide = createGuiStyleGuideCard(node);
      styleGuides.push(styleGuide);
    }
    
    figma.currentPage.selection = styleGuides;
    figma.closePlugin(`Created ${styleGuides.length} style guide card(s) successfully.`);
    
  } else if (command === 'create-icon-style-guide') {
    const selection = figma.currentPage.selection;
    if (!selection.length) {
      figma.closePlugin('Please select one or more objects.');
      return;
    }
    
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Medium' });
    await figma.loadFontAsync({ family: 'DM Mono', style: 'Regular' });
    
    const styleGuides: GroupNode[] = [];
    
    for (const node of selection) {
      const styleGuide = createIconStyleGuideCard(node);
      styleGuides.push(styleGuide);
    }
    
    figma.currentPage.selection = styleGuides;
    figma.closePlugin(`Created ${styleGuides.length} style guide card(s) successfully.`);
    
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