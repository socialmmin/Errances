import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(instance: Server) {
    io = instance;
}

export type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

/** Mirrors Supabase Realtime's `postgres_changes` payload shape so the frontend shim can stay unchanged. */
export function broadcastChange(table: string, eventType: ChangeEvent, row: { new?: any; old?: any }) {
    if (!io) return;
    io.emit(`postgres_changes:${table}`, {
        table,
        eventType,
        new: row.new ?? null,
        old: row.old ?? null,
    });
}
