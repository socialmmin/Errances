// Backend-agnostic client shim.
//
// This used to wrap `@supabase/supabase-js`. The app now talks to our own
// Express + PostgreSQL backend, but the rest of the codebase still calls
// `supabase.from(table)...`, `supabase.auth.*` and `supabase.channel(...)`
// exactly as before — so instead of touching every page/component, this
// file re-implements just the slice of the Supabase client API that's
// actually used here, backed by REST calls + a Socket.IO realtime feed.
import { io, type Socket } from 'socket.io-client';

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getAuthToken(): string | null {
    return localStorage.getItem('auth_token');
}

async function httpFetch(url: string, options: RequestInit = {}) {
    const token = getAuthToken();
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, { ...options, headers });
}

type PgError = { code?: string; message: string } | null;
type QueryResult = { data: any; error: PgError };

class QueryBuilder implements Promise<QueryResult> {
    readonly [Symbol.toStringTag] = 'QueryBuilder';

    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<QueryResult | TResult> {
        return this.execute().catch(onrejected);
    }

    finally(onfinally?: (() => void) | null): Promise<QueryResult> {
        return this.execute().finally(onfinally);
    }

    private table: string;
    private method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET';
    private selectCols = '*';
    private eqFilters: Array<[string, any]> = [];
    private inFilters: Array<[string, any[]]> = [];
    private orderClause: string | null = null;
    private limitValue: number | null = null;
    private body: any = null;
    private wantSingle = false;
    private wantMaybeSingle = false;

    constructor(table: string) {
        this.table = table;
    }

    select(cols?: string) {
        this.selectCols = cols || '*';
        return this;
    }

    insert(rows: any) {
        this.method = 'POST';
        this.body = { rows: Array.isArray(rows) ? rows : [rows] };
        return this;
    }

    update(values: Record<string, any>) {
        this.method = 'PATCH';
        this.body = { values };
        return this;
    }

    upsert(rows: any, opts?: { onConflict?: string }) {
        this.method = 'PUT';
        this.body = { rows: Array.isArray(rows) ? rows : [rows], onConflict: opts?.onConflict || 'id' };
        return this;
    }

    delete() {
        this.method = 'DELETE';
        return this;
    }

    eq(col: string, val: any) {
        this.eqFilters.push([col, val]);
        return this;
    }

    in(col: string, vals: any[]) {
        this.inFilters.push([col, vals]);
        return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
        this.orderClause = `${col}.${opts?.ascending === false ? 'desc' : 'asc'}`;
        return this;
    }

    limit(n: number) {
        this.limitValue = n;
        return this;
    }

    single() {
        this.wantSingle = true;
        return this;
    }

    maybeSingle() {
        this.wantMaybeSingle = true;
        return this;
    }

    private buildUrl() {
        const params = new URLSearchParams();
        if (this.method === 'GET') params.set('select', this.selectCols);
        this.eqFilters.forEach(([c, v]) => params.append(`eq_${c}`, String(v)));
        this.inFilters.forEach(([c, v]) => params.append(`in_${c}`, v.join(',')));
        if (this.orderClause) params.set('order', this.orderClause);
        if (this.limitValue != null) params.set('limit', String(this.limitValue));
        if (this.wantSingle) params.set('single', '1');
        if (this.wantMaybeSingle) params.set('maybeSingle', '1');
        const qs = params.toString();
        return `${API_BASE}/api/db/${this.table}${qs ? `?${qs}` : ''}`;
    }

    private async execute(): Promise<QueryResult> {
        try {
            const res = await httpFetch(this.buildUrl(), {
                method: this.method,
                body: this.body ? JSON.stringify(this.body) : undefined,
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = json.error;
                return { data: null, error: typeof err === 'string' ? { message: err } : err || { message: res.statusText } };
            }
            return { data: json.data ?? null, error: null };
        } catch (err: any) {
            return { data: null, error: { message: err?.message || 'Network error' } };
        }
    }

    then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this.execute().then(onfulfilled, onrejected);
    }
}

// --- auth ---

type Session = { access_token: string; user: { id: string; email: string; user_metadata: Record<string, any> } };
type AuthListener = (event: string, session: Session | null) => void;

const listeners = new Set<AuthListener>();

function getStoredSession(): Session | null {
    const token = localStorage.getItem('auth_token');
    const userStr = localStorage.getItem('auth_user');
    if (!token || !userStr) return null;
    try {
        const user = JSON.parse(userStr);
        return {
            access_token: token,
            user: {
                id: user.id,
                email: user.email,
                user_metadata: { full_name: user.full_name, avatar_url: user.avatar_url },
            },
        };
    } catch {
        return null;
    }
}

function notify(event: string, session: Session | null) {
    listeners.forEach((cb) => {
        try {
            cb(event, session);
        } catch (err) {
            console.error('auth listener error:', err);
        }
    });
}

export const auth = {
    async getSession() {
        return { data: { session: getStoredSession() }, error: null };
    },
    onAuthStateChange(callback: AuthListener) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
        try {
            const res = await fetch(`${API_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                return { error: { message: json.error || 'Invalid email or password' } };
            }
            localStorage.setItem('auth_token', json.token);
            localStorage.setItem('auth_user', JSON.stringify(json.user));
            notify('SIGNED_IN', getStoredSession());
            return { error: null };
        } catch (err: any) {
            return { error: { message: err?.message || 'Network error' } };
        }
    },
    async signInWithOtp(_args: { email: string; options?: any }) {
        return { error: { message: 'Magic-link sign-in is not available. Please sign in with your email and password.' } };
    },
    async signOut() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        notify('SIGNED_OUT', null);
        return { error: null };
    },
};

// --- realtime (Socket.IO standing in for Supabase Realtime `postgres_changes`) ---

let socket: Socket | null = null;
function getSocket(): Socket {
    if (!socket) socket = io(API_BASE || undefined, { transports: ['websocket', 'polling'] });
    return socket;
}

type ChangeFilter = { event: '*' | 'INSERT' | 'UPDATE' | 'DELETE'; schema: string; table: string };
type ChangePayload = { table: string; eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: any; old: any };

class RealtimeChannel {
    private bindings: Array<{ eventName: string; fn: (payload: ChangePayload) => void }> = [];
    private handlers: Array<{ filter: ChangeFilter; callback: (payload: ChangePayload) => void }> = [];

    on(_type: 'postgres_changes', filter: ChangeFilter, callback: (payload: ChangePayload) => void) {
        this.handlers.push({ filter, callback });
        return this;
    }

    subscribe() {
        const s = getSocket();
        this.handlers.forEach(({ filter, callback }) => {
            const eventName = `postgres_changes:${filter.table}`;
            const fn = (payload: ChangePayload) => {
                if (filter.event === '*' || filter.event === payload.eventType) callback(payload);
            };
            s.on(eventName, fn);
            this.bindings.push({ eventName, fn });
        });
        return this;
    }

    unsubscribe() {
        const s = getSocket();
        this.bindings.forEach(({ eventName, fn }) => s.off(eventName, fn));
        this.bindings = [];
    }
}

function channel(_name: string) {
    return new RealtimeChannel();
}

function removeChannel(chan: RealtimeChannel | null | undefined) {
    chan?.unsubscribe();
}

// --- exported client(s) ---
// `anonClient` used to be a separate unauthenticated Supabase client; with our
// own backend there's no separate anon key, so both names point at the same
// authenticated client.

export const supabase = {
    from(table: string) {
        return new QueryBuilder(table);
    },
    auth,
    channel,
    removeChannel,
};

export const anonClient = supabase;
