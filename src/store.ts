import { create } from "zustand";
import { createNodeFromType } from "./documentFactory";
import { initialDocument } from "./sampleDocument";
import type { BuilderNode, DocumentModel, ExportFormat, NodeType } from "./types";

interface BuilderState {
  document: DocumentModel;
  selectedNodeId: string | null;
  activeFormat: ExportFormat;
  history: DocumentModel[];
  future: DocumentModel[];
  selectNode: (id: string | null) => void;
  setActiveFormat: (format: ExportFormat) => void;
  addNode: (type: NodeType, parentId?: string | null) => void;
  replaceDocument: (document: DocumentModel) => void;
  updateNode: (id: string, patch: Partial<BuilderNode>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  moveNode: (id: string, direction: -1 | 1) => void;
  undo: () => void;
  redo: () => void;
}

const createId = () => `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const cloneDocument = (document: DocumentModel): DocumentModel => structuredClone(document);

const commit = (
  state: BuilderState,
  updater: (document: DocumentModel) => { document: DocumentModel; selectedNodeId?: string | null },
) => {
  const previous = cloneDocument(state.document);
  const result = updater(cloneDocument(state.document));

  return {
    document: result.document,
    selectedNodeId: result.selectedNodeId === undefined ? state.selectedNodeId : result.selectedNodeId,
    history: [...state.history, previous].slice(-40),
    future: [],
  };
};

const mapNodes = (
  nodes: BuilderNode[],
  id: string,
  mapper: (node: BuilderNode) => BuilderNode,
): BuilderNode[] =>
  nodes.map((node) => {
    if (node.id === id) {
      return mapper(node);
    }
    return {
      ...node,
      children: mapNodes(node.children, id, mapper),
    };
  });

const findNode = (nodes: BuilderNode[], id: string | null): BuilderNode | null => {
  if (!id) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findNode(node.children, id);
    if (child) {
      return child;
    }
  }

  return null;
};

const addNodeToTree = (nodes: BuilderNode[], parentId: string | null | undefined, node: BuilderNode) => {
  if (!parentId) {
    return [...nodes, node];
  }

  return mapNodes(nodes, parentId, (parent) => ({
    ...parent,
    children: [...parent.children, node],
  }));
};

const removeNode = (nodes: BuilderNode[], id: string): BuilderNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) => ({
      ...node,
      children: removeNode(node.children, id),
    }));

const duplicateInTree = (nodes: BuilderNode[], id: string): BuilderNode[] => {
  const result: BuilderNode[] = [];

  for (const node of nodes) {
    result.push({
      ...node,
      children: duplicateInTree(node.children, id),
    });

    if (node.id === id) {
      result.push(cloneWithNewIds(node));
    }
  }

  return result;
};

const cloneWithNewIds = (node: BuilderNode): BuilderNode => ({
  ...node,
  id: createId(),
  label: `${node.label} Copy`,
  children: node.children.map(cloneWithNewIds),
});

const moveInTree = (nodes: BuilderNode[], id: string, direction: -1 | 1): BuilderNode[] => {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) {
      return nodes;
    }
    const copy = [...nodes];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  }

  return nodes.map((node) => ({
    ...node,
    children: moveInTree(node.children, id, direction),
  }));
};

export const useBuilderStore = create<BuilderState>((set) => ({
  document: initialDocument,
  selectedNodeId: "node-name",
  activeFormat: "json",
  history: [],
  future: [],
  selectNode: (id) => set({ selectedNodeId: id }),
  setActiveFormat: (format) => set({ activeFormat: format }),
  addNode: (type, parentId) =>
    set((state) =>
      commit(state, (document) => {
        const parent = findNode(document.nodes, parentId ?? state.selectedNodeId);
        const resolvedParentId = parent && (parent.type === "section" || parent.type === "grid") ? parent.id : null;
        const node = createNodeFromType(type);
        document.nodes = addNodeToTree(document.nodes, resolvedParentId, node);
        return { document, selectedNodeId: node.id };
      }),
    ),
  replaceDocument: (nextDocument) =>
    set((state) =>
      commit(state, () => ({
        document: nextDocument,
        selectedNodeId: nextDocument.nodes[0]?.id ?? null,
      })),
    ),
  updateNode: (id, patch) =>
    set((state) =>
      commit(state, (document) => {
        document.nodes = mapNodes(document.nodes, id, (node) => ({
          ...node,
          ...patch,
          id: node.id,
          children: patch.children ?? node.children,
          props: patch.props ?? node.props,
        }));
        return { document };
      }),
    ),
  deleteNode: (id) =>
    set((state) =>
      commit(state, (document) => {
        document.nodes = removeNode(document.nodes, id);
        return { document, selectedNodeId: null };
      }),
    ),
  duplicateNode: (id) =>
    set((state) =>
      commit(state, (document) => {
        document.nodes = duplicateInTree(document.nodes, id);
        return { document };
      }),
    ),
  moveNode: (id, direction) =>
    set((state) =>
      commit(state, (document) => {
        document.nodes = moveInTree(document.nodes, id, direction);
        return { document };
      }),
    ),
  undo: () =>
    set((state) => {
      const previous = state.history[state.history.length - 1];
      if (!previous) {
        return state;
      }

      return {
        document: previous,
        history: state.history.slice(0, -1),
        future: [cloneDocument(state.document), ...state.future],
        selectedNodeId: null,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) {
        return state;
      }

      return {
        document: next,
        history: [...state.history, cloneDocument(state.document)],
        future: state.future.slice(1),
        selectedNodeId: null,
      };
    }),
}));

export const selectNodeById = (document: DocumentModel, id: string | null) => findNode(document.nodes, id);
