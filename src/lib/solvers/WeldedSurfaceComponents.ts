import { type BufferGeometry, Vector3 } from 'three'

/**
 * Finds connected surface components while treating identical 3D positions
 * across UV/material seams as the SAME topological vertex.
 *
 * Indexed triangle connectivity alone falsely splits Meshy/glTF models into
 * hundreds or thousands of texture islands. This utility uses the same
 * position-welding principle as SurfaceGeodesicWeightCalculator.
 */
export function welded_surface_components (
  geometry: BufferGeometry
): { componentByVertex: Int32Array, componentSizes: Map<number, number> } {
  const positions = geometry.getAttribute('position')
  const vertexCount = positions?.count ?? 0
  const parent = new Int32Array(vertexCount)
  for (let i = 0; i < vertexCount; i++) parent[i] = i

  const root = (i: number): number => {
    let x = i
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const x = root(a)
    const y = root(b)
    if (x !== y) parent[y] = x
  }

  geometry.computeBoundingBox()
  const diagonal = geometry.boundingBox?.getSize(new Vector3()).length() ?? 1
  const inverse = 1 / Math.max(1e-7, diagonal * 1e-6)
  const firstAtPosition = new Map<string, number>()
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const key =
      Math.round(positions.getX(vertex) * inverse) + ':' +
      Math.round(positions.getY(vertex) * inverse) + ':' +
      Math.round(positions.getZ(vertex) * inverse)
    const other = firstAtPosition.get(key)
    if (other !== undefined) union(vertex, other)
    else firstAtPosition.set(key, vertex)
  }

  const indices = geometry.getIndex()
  if (indices !== null) {
    for (let i = 0; i + 2 < indices.count; i += 3) {
      const a = indices.getX(i)
      const b = indices.getX(i + 1)
      const c = indices.getX(i + 2)
      union(a, b); union(b, c)
    }
  } else {
    // Triangle soup without an index still contains face adjacency via
    // coincident positions on neighboring triangles.
    for (let i = 0; i + 2 < vertexCount; i += 3) {
      union(i, i + 1); union(i + 1, i + 2)
    }
  }

  const componentByVertex = new Int32Array(vertexCount)
  const componentSizes = new Map<number, number>()
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const id = root(vertex)
    componentByVertex[vertex] = id
    componentSizes.set(id, (componentSizes.get(id) ?? 0) + 1)
  }
  return { componentByVertex, componentSizes }
}
