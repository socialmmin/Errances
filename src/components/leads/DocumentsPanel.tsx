import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, Download, Trash2, Eye, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { uploadFile } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import type { LeadDocument } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const DOC_TYPES = ['passport', 'aadhaar_id', 'pan', 'quotation', 'invoice', 'agreement', 'other'];
const DOC_LABELS: Record<string, string> = {
    passport: 'Passport', aadhaar_id: 'Aadhaar / ID', pan: 'PAN', quotation: 'Quotation',
    invoice: 'Invoice', agreement: 'Agreement', other: 'Supporting Document',
};

export function DocumentsPanel({ leadId }: { leadId: string }) {
    const { fetchLeadDocuments, addLeadDocument, deleteLeadDocument, user } = useAppStore();
    const [docs, setDocs] = useState<LeadDocument[]>([]);
    const [docType, setDocType] = useState('other');
    const [isUploading, setIsUploading] = useState(false);
    const [preview, setPreview] = useState<LeadDocument | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const load = async () => setDocs(await fetchLeadDocuments(leadId));
    useEffect(() => { load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleFile = async (file: File) => {
        setIsUploading(true);
        try {
            const url = await uploadFile(file);
            await addLeadDocument({
                lead_id: leadId,
                name: file.name,
                doc_type: docType,
                file_url: url,
                uploaded_by: user?.id,
                uploaded_by_name: user?.full_name,
            });
            await load();
        } catch (err: any) {
            toast.error(err.message || 'Failed to upload document');
        } finally {
            setIsUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const isImage = (url: string) => /\.(png|jpe?g|gif|webp)$/i.test(url) || url.startsWith('data:image');

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 justify-between">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Documents</h4>
                <div className="flex items-center gap-2">
                    <Select value={docType} onValueChange={setDocType}>
                        <SelectTrigger className="h-9 w-44 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{DOC_LABELS[t]}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    <Button size="sm" className="h-9 text-xs" onClick={() => inputRef.current?.click()} disabled={isUploading}>
                        {isUploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                        Upload
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {docs.length === 0 && <p className="text-sm text-slate-400 italic text-center py-6 col-span-2">No documents uploaded yet.</p>}
                {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-200 bg-white">
                        <div className="h-11 w-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0 overflow-hidden">
                            {isImage(doc.file_url) ? <img src={doc.file_url} className="h-full w-full object-cover" /> : <FileText className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{doc.name}</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{DOC_LABELS[doc.doc_type] || doc.doc_type} · {doc.uploaded_by_name || 'Unknown'} · {format(new Date(doc.created_at), 'dd MMM yyyy')}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => setPreview(doc)} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><Eye className="h-4 w-4" /></button>
                            <a href={doc.file_url} download={doc.name} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"><Download className="h-4 w-4" /></a>
                            <button onClick={async () => { await deleteLeadDocument(doc.id); load(); }} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                        </div>
                    </div>
                ))}
            </div>

            <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>{preview?.name}</DialogTitle></DialogHeader>
                    {preview && (isImage(preview.file_url) ? (
                        <img src={preview.file_url} className="w-full rounded-xl object-contain max-h-[70vh]" />
                    ) : (
                        <iframe src={preview.file_url} className="w-full h-[70vh] rounded-xl border" />
                    ))}
                </DialogContent>
            </Dialog>
        </div>
    );
}
