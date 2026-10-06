'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { TourPackage } from '@/types/package';

interface PackageListResponse {
  data: TourPackage[];
  total: number;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  created_time?: string;
  updated_time?: string;
}

export function useMetaCampaigns() {
  return useQuery({
    queryKey: ['meta-campaigns'],
    queryFn: () => api.get<{ data: MetaCampaign[]; updatedAt: string }>('/integrations/meta/campaigns'),
    refetchInterval: 60_000,
  });
}

export interface CampaignGap { id: string; name: string; reason: 'no_itinerary_mapped' | 'template_not_approved' | 'itinerary_inactive' | 'auto_paused'; packageId: string | null }
export interface CampaignCoverage { activeCampaigns: number; covered: number; gaps: CampaignGap[] }

export function useCampaignCoverage(opts: { enabled?: boolean } = {}) {
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['campaign-coverage'],
    queryFn: () => api.get<CampaignCoverage>('/integrations/meta/campaign-coverage'),
    refetchInterval: 60_000,
  });
}

export function getPackageDocumentPreview(objectKey: string) {
  return api.get<{ url: string | null }>(`/packages/document-preview?objectKey=${encodeURIComponent(objectKey)}`);
}

export function usePackages(params: { search?: string; type?: string; isTemplate?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.type) qs.set('type', params.type);
  if (params.isTemplate !== undefined) qs.set('isTemplate', String(params.isTemplate));
  const query = qs.toString();
  return useQuery({
    queryKey: ['packages', params],
    queryFn: () => api.get<PackageListResponse>(`/packages${query ? `?${query}` : ''}`),
  });
}

export function usePackage(id: string) {
  return useQuery({
    queryKey: ['packages', id],
    queryFn: () => api.get<TourPackage>(`/packages/${id}`),
    enabled: !!id,
  });
}

export function useCreatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post<TourPackage>('/packages', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });
}

export function useUpdatePackage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => api.patch<TourPackage>(`/packages/${id}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages'] });
      qc.invalidateQueries({ queryKey: ['packages', id] });
    },
  });
}

export interface PackageDocument {
  id: string; package_id: string; sort_order: number;
  duration_days: number | null; duration_nights: number | null;
  object_key: string | null; file_name: string | null;
  whatsapp_template_id: string | null; whatsapp_template_name: string | null;
  whatsapp_template_status: string | null; whatsapp_template_rejection_reason: string | null;
}

// Additional itinerary documents beyond the primary one -- "Add another", no fixed limit.
export function usePackageDocuments(packageId?: string) {
  return useQuery({
    queryKey: ['packages', packageId, 'documents'],
    queryFn: () => api.get<PackageDocument[]>(`/packages/${packageId}/documents`),
    enabled: !!packageId,
  });
}
export function useAddPackageDocument(packageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { durationDays?: number; durationNights?: number; objectKey: string; fileName: string }) => api.post<PackageDocument>(`/packages/${packageId}/documents`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages', packageId, 'documents'] }),
  });
}
export function useUpdatePackageDocument(packageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; durationDays?: number; durationNights?: number }) => api.patch<PackageDocument>(`/packages/${packageId}/documents/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages', packageId, 'documents'] }),
  });
}
export function useDeletePackageDocument(packageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/packages/${packageId}/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages', packageId, 'documents'] }),
  });
}

export function useDeletePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/packages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_MB = 5;

export async function uploadPackageImage(file: File, folder: string): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only JPG, PNG, or WEBP images are allowed');
  }
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new Error(`Image must be under ${MAX_IMAGE_MB}MB`);
  }
  const token = useAuthStore.getState().accessToken;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);
  const res = await fetch(`${API_URL}/files/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message || message;
    } catch {
      /* ignore */
    }
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  const data = await res.json();
  return data.url as string;
}

// Mirrors WhatsApp Cloud API's own media limits: documents up to 100MB,
// images up to 5MB.
const MAX_DOCUMENT_MB = 100;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const ACCEPTED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', ...IMAGE_EXTENSIONS];

// Uploads go straight to R2 from the browser via a presigned PUT, not through this backend --
// relaying the bytes through the VPS first (browser -> VPS -> R2) doubled the transfer time and
// was bounded by the VPS's own outbound bandwidth, which made large itinerary PDFs painfully slow
// to upload. The presign call itself is tiny and fast; only the actual file bytes go direct.
export async function uploadPackageDocument(file: File, folder: string, onProgress?: (loaded: number, total: number) => void): Promise<{ url: string; objectKey: string }> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ACCEPTED_DOCUMENT_EXTENSIONS.includes(extension)) {
    throw new Error('Upload a PDF, Word, Excel, PowerPoint, text or image file');
  }
  const isImage = IMAGE_EXTENSIONS.includes(extension);
  const maxMb = isImage ? MAX_IMAGE_MB : MAX_DOCUMENT_MB;
  if (file.size > maxMb * 1024 * 1024) {
    throw new Error(`${isImage ? 'Image' : 'Document'} must be under ${maxMb}MB`);
  }
  const contentType = file.type || 'application/octet-stream';
  const { uploadUrl, objectKey } = await api.post<{ uploadUrl: string; objectKey: string }>('/files/presign-upload', { fileName: file.name, contentType, folder });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.send(file);
  });
  const preview = await getPackageDocumentPreview(objectKey).catch(() => ({ url: null }));
  return { url: preview.url || '', objectKey };
}

export interface ItineraryPreset { id: string; kind: 'name' | 'number' | 'button' | 'message' | 'setup' | 'reply' | 'link'; value: string }

export function useItineraryPresets() {
  return useQuery({ queryKey: ['itinerary-presets'], queryFn: () => api.get<ItineraryPreset[]>('/packages/presets') });
}

export function useItineraryPresetActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['itinerary-presets'] });
  const add = useMutation({ mutationFn: (v: { kind: ItineraryPreset['kind']; value: string }) => api.post('/packages/presets', v), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: string; value: string }) => api.patch(`/packages/presets/${v.id}`, { value: v.value }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/packages/presets/${id}`), onSuccess: refresh });
  return { add, update, remove };
}

export async function fetchPackageDocumentBytes(objectKey: string): Promise<ArrayBuffer> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${API_URL}/packages/document-file?objectKey=${encodeURIComponent(objectKey)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error('Could not load the document');
  return res.arrayBuffer();
}
