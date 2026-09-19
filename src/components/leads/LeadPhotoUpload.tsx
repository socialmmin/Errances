import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2, User } from 'lucide-react';
import { uploadFile } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

export function LeadPhotoUpload({
    photoUrl,
    onChange,
    name,
}: {
    photoUrl?: string | null;
    onChange: (url: string | null) => void;
    name: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);

    const handleFile = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            toast.error('Please choose an image file.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error('Image must be smaller than 10MB.');
            return;
        }
        setIsUploading(true);
        try {
            const url = await uploadFile(file);
            onChange(url);
            toast.success('Photo updated');
        } catch (err: any) {
            toast.error(err.message || 'Failed to upload photo');
        } finally {
            setIsUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <div className="flex flex-col items-center gap-2.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 self-start pl-1">Lead Photo</p>
            <div
                className="relative w-28 h-36 rounded-xl overflow-hidden bg-slate-100 border-2 border-white shadow-md ring-1 ring-slate-200 group cursor-pointer"
                onClick={() => (photoUrl ? setPreviewOpen(true) : inputRef.current?.click())}
            >
                {photoUrl ? (
                    <img src={photoUrl} alt={name} className="w-full h-full object-cover object-center" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-300">
                        <User className="w-9 h-9" />
                    </div>
                )}
                {isUploading && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                    </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Camera className="h-5 w-5 text-white" />
                </div>
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                }}
            />
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700"
                >
                    {photoUrl ? 'Change Photo' : 'Upload Photo'}
                </button>
                {photoUrl && (
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="text-[11px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                        <Trash2 className="h-3 w-3" /> Remove
                    </button>
                )}
            </div>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{name}</DialogTitle>
                    </DialogHeader>
                    {photoUrl && (
                        <img src={photoUrl} alt={name} className="w-full rounded-xl object-contain max-h-[70vh]" />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
