import type { ChangedFileInfo } from "../../electronAPI/git"
import { splitPath } from "./paths"

export interface FileTreeNode {
    name: string
    path: string
    isDir: boolean
    children: FileTreeNode[]
    file?: ChangedFileInfo
    fileCount: number
}

export interface FlatTreeEntry {
    node: FileTreeNode
    depth: number
}

function sortTreeNodes(nodes: FileTreeNode[]): void {
    nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1
        }
        return a.name.localeCompare(b.name)
    })

    for (const node of nodes) {
        if (node.isDir) {
            sortTreeNodes(node.children)
        }
    }
}

function computeFileCounts(nodes: FileTreeNode[]): number {
    let total = 0

    for (const node of nodes) {
        if (node.isDir) {
            node.fileCount = computeFileCounts(node.children)
        } else {
            node.fileCount = 1
        }
        total += node.fileCount
    }

    return total
}

function getOrCreateDirNode(parentChildren: FileTreeNode[], name: string, path: string): FileTreeNode {
    const existing = parentChildren.find((child) => child.isDir && child.name === name)
    if (existing) {
        return existing
    }

    const dirNode: FileTreeNode = {
        name,
        path,
        isDir: true,
        children: [],
        fileCount: 0,
    }

    parentChildren.push(dirNode)
    return dirNode
}

export function buildFileTree(files: ChangedFileInfo[]): FileTreeNode[] {
    const rootNodes: FileTreeNode[] = []

    for (const file of files) {
        const parts = splitPath(file.path)
        if (parts.length === 0) {
            continue
        }

        let currentChildren = rootNodes

        for (let i = 0; i < parts.length; i++) {
            const name = parts[i]
            const nodePath = parts.slice(0, i + 1).join("/")
            const isLeaf = i === parts.length - 1

            if (isLeaf) {
                const fileNode: FileTreeNode = {
                    name,
                    path: nodePath,
                    isDir: false,
                    children: [],
                    file,
                    fileCount: 1,
                }

                const existingIndex = currentChildren.findIndex((child) => !child.isDir && child.name === name)
                if (existingIndex >= 0) {
                    currentChildren[existingIndex] = fileNode
                } else {
                    currentChildren.push(fileNode)
                }
            } else {
                const dirNode = getOrCreateDirNode(currentChildren, name, nodePath)
                currentChildren = dirNode.children
            }
        }
    }

    sortTreeNodes(rootNodes)
    computeFileCounts(rootNodes)

    return rootNodes
}

export function flattenFileTree(nodes: FileTreeNode[], expandedPaths: Set<string>, depth = 0): FlatTreeEntry[] {
    const entries: FlatTreeEntry[] = []

    for (const node of nodes) {
        entries.push({ node, depth })
        if (node.isDir && expandedPaths.has(node.path)) {
            entries.push(...flattenFileTree(node.children, expandedPaths, depth + 1))
        }
    }

    return entries
}

export function collectAllDirPaths(nodes: FileTreeNode[]): Set<string> {
    const dirPaths = new Set<string>()

    const walk = (treeNodes: FileTreeNode[]) => {
        for (const node of treeNodes) {
            if (node.isDir) {
                dirPaths.add(node.path)
                walk(node.children)
            }
        }
    }

    walk(nodes)
    return dirPaths
}
