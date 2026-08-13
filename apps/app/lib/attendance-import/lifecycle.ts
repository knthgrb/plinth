export interface AttendanceImportRequestContext {
  generation: number;
  signal: AbortSignal;
}

export interface AttendanceImportRequestCallbacks<T> {
  onStart: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onFinish: () => void;
}

export class AttendanceImportRequestCoordinator {
  private generation = 0;
  private activeController: AbortController | null = null;

  begin(): AttendanceImportRequestContext {
    this.activeController?.abort();
    this.generation += 1;
    this.activeController = new AbortController();

    return {
      generation: this.generation,
      signal: this.activeController.signal,
    };
  }

  invalidate(): void {
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }

  isCurrent(generation: number): boolean {
    return (
      generation === this.generation &&
      this.activeController !== null &&
      !this.activeController.signal.aborted
    );
  }

  complete(generation: number): boolean {
    if (!this.isCurrent(generation)) {
      return false;
    }

    this.activeController = null;
    return true;
  }
}

export async function runLatestAttendanceImportRequest<T>(
  coordinator: AttendanceImportRequestCoordinator,
  request: (signal: AbortSignal) => Promise<T>,
  callbacks: AttendanceImportRequestCallbacks<T>,
): Promise<void> {
  const { generation, signal } = coordinator.begin();
  callbacks.onStart();

  try {
    const value = await request(signal);

    if (coordinator.isCurrent(generation)) {
      callbacks.onSuccess(value);
    }
  } catch (error: unknown) {
    if (coordinator.isCurrent(generation)) {
      callbacks.onError(error);
    }
  } finally {
    if (coordinator.complete(generation)) {
      callbacks.onFinish();
    }
  }
}

export function areAttendanceImportLookupsReady(
  employees: readonly unknown[] | undefined,
  holidays: readonly unknown[] | undefined,
): boolean {
  return employees !== undefined && holidays !== undefined;
}

export function isAttendanceConflictCheckPending(
  hasImportableRows: boolean,
  attendanceRecords: readonly unknown[] | undefined,
): boolean {
  return hasImportableRows && attendanceRecords === undefined;
}

export function handleAttendanceDialogOpenChange(
  open: boolean,
  invalidateImport: () => void,
  setOpen: (open: boolean) => void,
): void {
  if (!open) {
    invalidateImport();
  }

  setOpen(open);
}
