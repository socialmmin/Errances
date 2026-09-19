import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { calculateAge } from '@/lib/leadUtils';
import { cn } from '@/lib/utils';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function toISODate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatDisplay(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Tries a handful of common manual-entry formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD. */
function parseTyped(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
    if (iso) {
        const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        if (!Number.isNaN(d.getTime())) return toISODate(d);
    }

    const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(trimmed);
    if (dmy) {
        const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        if (!Number.isNaN(d.getTime())) return toISODate(d);
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);

    return null;
}

export function DateOfBirthPicker({
    value,
    onChange,
    disabled,
}: {
    value?: string | null;
    onChange: (isoDate: string | null) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(value ? formatDisplay(value) : '');
    const currentYear = new Date().getFullYear();
    const oldestYear = currentYear - 100;
    const [viewMonth, setViewMonth] = useState<Date>(value ? new Date(value) : new Date(currentYear - 25, 0));

    useEffect(() => {
        setText(value ? formatDisplay(value) : '');
    }, [value]);

    useEffect(() => {
        if (open) setViewMonth(value ? new Date(value) : new Date(currentYear - 25, 0));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const years = useMemo(() => {
        const arr: number[] = [];
        for (let y = currentYear; y >= oldestYear; y--) arr.push(y);
        return arr;
    }, [currentYear, oldestYear]);

    const age = calculateAge(value);

    const goToMonth = (delta: number) => {
        setViewMonth((prev) => {
            const next = new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
            if (next.getFullYear() < oldestYear || next.getFullYear() > currentYear) return prev;
            return next;
        });
    };

    return (
        <div className="space-y-1.5">
            <div className="relative">
                <CalendarDays className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                    value={text}
                    disabled={disabled}
                    placeholder="e.g. 18 September 1998 or 18/09/1998"
                    className="pl-10 pr-16 h-11 rounded-xl font-semibold text-sm"
                    onChange={(e) => setText(e.target.value)}
                    onBlur={() => {
                        const parsed = parseTyped(text);
                        if (parsed) {
                            onChange(parsed);
                            setText(formatDisplay(parsed));
                        } else if (!text.trim()) {
                            onChange(null);
                        } else {
                            // Invalid text — revert to last valid value.
                            setText(value ? formatDisplay(value) : '');
                        }
                    }}
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                    {value && !disabled && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange(null);
                                setText('');
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                            title="Clear date"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                disabled={disabled}
                                className="p-1.5 text-indigo-500 hover:text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40"
                                title="Open calendar"
                            >
                                <CalendarDays className="h-3.5 w-3.5" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-3" align="end" sideOffset={8}>
                            {/* Custom month/year header — replaces react-day-picker's built-in
                                dropdown caption, which renders unstyled duplicate native <select>s. */}
                            <div className="flex items-center gap-1.5 mb-3">
                                <button
                                    type="button"
                                    onClick={() => goToMonth(-1)}
                                    className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <Select
                                    value={String(viewMonth.getMonth())}
                                    onValueChange={(v) => setViewMonth((prev) => new Date(prev.getFullYear(), Number(v), 1))}
                                >
                                    <SelectTrigger className="h-8 flex-1 text-xs font-bold rounded-lg"><SelectValue /></SelectTrigger>
                                    <SelectContent className="max-h-64">
                                        {MONTH_NAMES.map((m, idx) => <SelectItem key={m} value={String(idx)}>{m}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={String(viewMonth.getFullYear())}
                                    onValueChange={(v) => setViewMonth((prev) => new Date(Number(v), prev.getMonth(), 1))}
                                >
                                    <SelectTrigger className="h-8 w-[84px] flex-shrink-0 text-xs font-bold rounded-lg"><SelectValue /></SelectTrigger>
                                    <SelectContent className="max-h-64">
                                        {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <button
                                    type="button"
                                    onClick={() => goToMonth(1)}
                                    className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                            <Calendar
                                mode="single"
                                month={viewMonth}
                                onMonthChange={setViewMonth}
                                classNames={{ month_caption: 'hidden', nav: 'hidden', month: 'space-y-0' }}
                                selected={value ? new Date(value) : undefined}
                                onSelect={(d) => {
                                    if (!d) return;
                                    const iso = toISODate(d);
                                    onChange(iso);
                                    setText(formatDisplay(iso));
                                    setOpen(false);
                                }}
                                disabled={{ after: new Date(), before: new Date(oldestYear, 0, 1) }}
                                className="p-0"
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
            {age !== null && (
                <p className={cn('text-[11px] font-bold pl-1', age < 0 ? 'text-red-500' : 'text-emerald-600')}>
                    Age: {age} {age === 1 ? 'Year' : 'Years'}
                </p>
            )}
        </div>
    );
}
