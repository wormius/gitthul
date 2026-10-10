/**
 * Aplanado del árbol: de nodos anidados a la lista de filas que se ven.
 *
 * Va aparte del componente porque es la parte con reglas propias — la expansión
 * encadenada de carpetas de hijo único y el conteo de hojas al plegar — y porque
 * así se puede probar sin montar nada.
 */

export interface TreeNode {
  id: string;
  label: string;
  /** Ausente en las hojas. Presente y vacío es una carpeta vacía, que no es lo mismo. */
  children?: readonly TreeNode[];
}

export interface FlatTreeNode {
  /** Identidad de la fila. En una cadena fusionada es la del nodo más profundo. */
  id: string;
  /** `src/ui/gallery` cuando la cadena se fusionó; el nombre a secas si no. */
  label: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  /** Hojas por debajo, para el conteo que se enseña al plegar una carpeta. */
  leafCount: number;
  /** Los nodos que la fila representa, del más superficial al más profundo. */
  chain: readonly TreeNode[];
  node: TreeNode;
  setSize: number;
  posInSet: number;
}

export interface FlattenOptions {
  /**
   * Funde las carpetas que solo contienen otra carpeta en una sola fila. Es lo
   * que evita la escalera de `src` → `ui` → `gallery` con un elemento por
   * nivel, y hace que abrir una ruta profunda cueste un clic y no cuatro.
   */
  chainSingleChild?: boolean;
  separator?: string;
}

function isFolder(node: TreeNode): boolean {
  return node.children !== undefined;
}

/** Recorre la cadena de carpetas de hijo único que arranca en `node`. */
function chainOf(node: TreeNode, enabled: boolean): TreeNode[] {
  const chain = [node];

  if (!enabled) return chain;

  let current = node;

  while (current.children?.length === 1) {
    const only = current.children[0];

    if (!only || !isFolder(only)) break;

    chain.push(only);
    current = only;
  }

  return chain;
}

export function countLeaves(node: TreeNode): number {
  if (!node.children) return 1;

  let total = 0;

  for (const child of node.children) total += countLeaves(child);

  return total;
}

export function flattenTree(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  options: FlattenOptions = {},
): FlatTreeNode[] {
  const { chainSingleChild = true, separator = '/' } = options;
  const rows: FlatTreeNode[] = [];

  const walk = (siblings: readonly TreeNode[], depth: number) => {
    siblings.forEach((node, index) => {
      const chain = chainOf(node, chainSingleChild);
      const deepest = chain[chain.length - 1] ?? node;
      const children = deepest.children;
      const hasChildren = children !== undefined && children.length > 0;
      const isExpanded = hasChildren && expanded.has(deepest.id);

      rows.push({
        id: deepest.id,
        label: chain.map((step) => step.label).join(separator),
        depth,
        expanded: isExpanded,
        hasChildren,
        leafCount: countLeaves(deepest),
        chain,
        node: deepest,
        setSize: siblings.length,
        posInSet: index + 1,
      });

      if (isExpanded && children) walk(children, depth + 1);
    });
  };

  walk(nodes, 0);

  return rows;
}
