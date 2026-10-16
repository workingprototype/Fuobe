// Small toolkit for editing ComfyUI API-format prompts ({ [nodeId]: {class_type, inputs, _meta} }).
// Used by build-library.mjs to turn raw template exports into the workflows Fuobe ships.

export const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && Number.isInteger(v[1]);

export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Every [consumerId, inputName] that reads from node `id` (optionally a specific output slot). */
export function consumers(g, id, slot) {
  const out = [];
  for (const [nid, n] of Object.entries(g)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (isLink(v) && v[0] === id && (slot === undefined || v[1] === slot)) out.push([nid, k, v[1]]);
    }
  }
  return out;
}

/** Output nodes = nodes whose class is an output node according to /object_info. */
export function outputNodeIds(g, objectInfo) {
  return Object.keys(g).filter((id) => objectInfo[g[id].class_type]?.output_node);
}

/** Remove every node that is not an ancestor of a kept output node. */
export function prune(g, objectInfo, keepOutputs) {
  const roots = keepOutputs || outputNodeIds(g, objectInfo);
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !g[id]) continue;
    seen.add(id);
    for (const v of Object.values(g[id].inputs || {})) if (isLink(v)) stack.push(v[0]);
  }
  for (const id of Object.keys(g)) if (!seen.has(id)) delete g[id];
  return g;
}

function constBool(g, v) {
  if (typeof v === 'boolean') return v;
  if (isLink(v)) {
    const src = g[v[0]];
    if (src && src.class_type === 'PrimitiveBoolean' && typeof src.inputs.value === 'boolean') return src.inputs.value;
  }
  return undefined;
}

/**
 * Resolve ComfySwitchNode whose `switch` is a constant (literal or PrimitiveBoolean) by
 * rewiring every consumer straight to the selected branch. Optionally force
 * PrimitiveBoolean values first (e.g. {"129:131": true} to enable a 4-step LoRA path).
 * Unselected branches become unreachable and disappear on prune(), so the final
 * workflow only references the models it actually uses.
 */
export function resolveSwitches(g, booleans = {}) {
  for (const [id, val] of Object.entries(booleans)) {
    if (!g[id]) throw new Error(`resolveSwitches: node ${id} not found`);
    g[id].inputs.value = val;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, n] of Object.entries(g)) {
      if (n.class_type !== 'ComfySwitchNode') continue;
      const b = constBool(g, n.inputs.switch);
      if (b === undefined) continue;
      const chosen = b ? n.inputs.on_true : n.inputs.on_false;
      for (const [cid, k] of consumers(g, id)) {
        if (chosen === undefined) delete g[cid].inputs[k];
        else g[cid].inputs[k] = clone(chosen);
      }
      delete g[id];
      changed = true;
    }
  }
  return g;
}

/** Set literal inputs (replaces links too). values: [{node,input,value}] */
export function setInputs(g, values) {
  for (const { node, input, value } of values) {
    if (!g[node]) throw new Error(`setInputs: node ${node} not found`);
    if (value === undefined) delete g[node].inputs[input];
    else g[node].inputs[input] = clone(value);
  }
  return g;
}

/** Remove input keys (e.g. V3 dynamic sub-inputs "mode.mask_1"). */
export function deleteInputs(g, list) {
  for (const { node, input } of list) {
    if (!g[node]) throw new Error(`deleteInputs: node ${node} not found`);
    delete g[node].inputs[input];
  }
  return g;
}

export function removeNodes(g, ids) {
  for (const id of ids) {
    if (!g[id]) throw new Error(`removeNodes: node ${id} not found`);
    delete g[id];
  }
  return g;
}

export function addNodes(g, nodes) {
  for (const [id, n] of Object.entries(nodes)) {
    if (g[id]) throw new Error(`addNodes: node ${id} already exists`);
    g[id] = clone(n);
  }
  return g;
}

/** Replace every reference to [fromId, fromSlot] with [toId, toSlot]. */
export function rewire(g, from, to) {
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (isLink(v) && v[0] === from[0] && v[1] === from[1]) n.inputs[k] = [to[0], to[1]];
    }
  }
  return g;
}

/**
 * Insert a node between an existing link source and all its consumers, e.g. a
 * LoraLoaderModelOnly after a UNETLoader:
 *   insertAfter(g, ['129:95', 0], '1001', {class_type:'LoraLoaderModelOnly', inputs:{lora_name, strength_model}}, 'model')
 */
export function insertAfter(g, source, newId, node, inputName, onlyConsumers) {
  const cons = consumers(g, source[0], source[1]).filter(([cid]) => !onlyConsumers || onlyConsumers.includes(cid));
  addNodes(g, { [newId]: node });
  g[newId].inputs[inputName] = [source[0], source[1]];
  for (const [cid, k] of cons) g[cid].inputs[k] = [newId, 0];
  return g;
}

/** Rename model files everywhere they appear as string inputs (exact match). */
export function renameValues(g, map) {
  for (const n of Object.values(g)) {
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)) n.inputs[k] = map[v];
    }
  }
  return g;
}

/** Sort node ids numerically (with "a:b" subgraph ids after their parent) for stable diffs. */
export function sortGraph(g) {
  const key = (id) => id.split(':').map((p) => (/^\d+$/.test(p) ? p.padStart(8, '0') : p)).join(':');
  return Object.fromEntries(Object.entries(g).sort(([a], [b]) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)));
}

/** Sanity checks: dangling links, missing classes. Returns list of problems. */
export function lint(g, objectInfo) {
  const problems = [];
  for (const [id, n] of Object.entries(g)) {
    if (!n.class_type) problems.push(`node ${id} has no class_type (missing custom node?)`);
    else if (objectInfo && !objectInfo[n.class_type]) problems.push(`node ${id}: class ${n.class_type} not installed`);
    for (const [k, v] of Object.entries(n.inputs || {})) {
      if (isLink(v) && !g[v[0]]) problems.push(`node ${id}.${k} links to missing node ${v[0]}`);
    }
  }
  return problems;
}
