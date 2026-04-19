/**
 * Module-level set of board ids the user has just deleted (or is in the
 * process of deleting). Both WhiteboardPanel (delete trigger) and
 * WhiteboardInner (autosave guard) import this so the in-flight delete
 * can short-circuit any trailing autosave. This used to be inlined in
 * WhiteboardInner but that pulled Excalidraw's bundle into anything
 * that needed the marker — kept here in a leaf module so the set can
 * be shared without dragging the Excalidraw client-only import along.
 */

const deletedBoardIds = new Set<string>();

export function markBoardDeleted(boardId: string): void {
  if (boardId) deletedBoardIds.add(boardId);
}

export function isBoardMarkedDeleted(boardId: string): boolean {
  return deletedBoardIds.has(boardId);
}
