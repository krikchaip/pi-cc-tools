export interface PresentationSettlement {
  complete(): void;
}

const pendingByOwner = new WeakMap<object, number>();

export function beginPresentationSettlement(
  owner: object,
  onComplete: () => void,
): PresentationSettlement {
  pendingByOwner.set(owner, (pendingByOwner.get(owner) ?? 0) + 1);
  let completed = false;

  return {
    complete(): void {
      if (completed) return;
      completed = true;

      const remaining = (pendingByOwner.get(owner) ?? 1) - 1;
      if (remaining > 0) pendingByOwner.set(owner, remaining);
      else pendingByOwner.delete(owner);

      onComplete();
    },
  };
}

export function hasPendingPresentation(owner: object): boolean {
  return (pendingByOwner.get(owner) ?? 0) > 0;
}
