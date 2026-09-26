/** Builds a CSV file from an array of flat objects and triggers a browser download. */
export function downloadCSV(filename: string, rows: Array<Record<string, string | number>>) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const escape = (value: string | number) => {
        const str = String(value ?? '');
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
