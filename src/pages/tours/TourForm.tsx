import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { ArrowLeft, Save, X, Upload, Loader2, Plus, FileText, GripVertical } from "lucide-react";
import type { ItineraryDay, TourPackage } from "@/types";
import { uploadTourImage, uploadFile } from "@/lib/api";
import { useRef } from "react";

const tourSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  destination: z.string().min(2, "Destination is required"),
  duration: z.coerce.number().min(1, "Duration must be at least 1 day"),
  price_on_request: z.boolean(),
  price: z.coerce.number().min(0, "Price must be positive"),
  description: z.string().min(10, "Description needs to be longer"),
  status: z.enum(["active", "inactive", "draft"]),
  departure_city: z.string().optional(),
  availability: z.string().optional(),
  accommodation: z.string().optional(),
  meals: z.string().optional(),
  transport: z.string().optional(),
  cancellation_policy: z.string().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
  highlights: z.string().optional(),
  itinerary: z.string().optional(), // HTML content
});

type TourFormValues = z.infer<typeof tourSchema>;

export function TourForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { tours, addTour, updateTour, fetchTours } = useAppStore();
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => { if (id) void fetchTours().finally(() => setLoaded(true)); }, [id, fetchTours]);
  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dayWiseItinerary, setDayWiseItinerary] = useState<ItineraryDay[]>([]);
  const [itineraryPdfUrl, setItineraryPdfUrl] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Check if we are in edit mode and find the tour
  const isEditMode = !!id;
  const existingTour = isEditMode ? tours.find((t) => t.id === id) : undefined;

  const form = useForm<TourFormValues>({
    resolver: zodResolver(tourSchema) as any,
    defaultValues: {
      price_on_request: existingTour?.price_on_request || false,
      title: existingTour?.title || "",
      destination: existingTour?.destination || "",
      duration: existingTour?.duration || 1,
      price: existingTour?.price || 0,
      description: existingTour?.description || "",
      status: existingTour?.status || "active",
      itinerary: existingTour?.itinerary || "",
      departure_city: existingTour?.departure_city || "",
      availability: existingTour?.availability || "",
      accommodation: existingTour?.accommodation || "",
      meals: existingTour?.meals || "",
      transport: existingTour?.transport || "",
      cancellation_policy: existingTour?.cancellation_policy || "",
      inclusions: existingTour?.inclusions?.join("\n") || "",
      exclusions: existingTour?.exclusions?.join("\n") || "",
      highlights: existingTour?.highlights?.join("\n") || "",
    },
  });

  useEffect(() => {
    if (existingTour) {
      setImages(existingTour.images || []);
      setDayWiseItinerary(existingTour.day_wise_itinerary || []);
      setItineraryPdfUrl(existingTour.itinerary_pdf_url || null);
      form.reset({
        price_on_request: existingTour.price_on_request || false,
        title: existingTour.title,
        destination: existingTour.destination,
        duration: existingTour.duration,
        price: existingTour.price,
        description: existingTour.description,
        status: existingTour.status,
        itinerary: existingTour.itinerary,
        departure_city: existingTour.departure_city || "",
        availability: existingTour.availability || "",
        accommodation: existingTour.accommodation || "",
        meals: existingTour.meals || "",
        transport: existingTour.transport || "",
        cancellation_policy: existingTour.cancellation_policy || "",
        inclusions: existingTour.inclusions?.join("\n") || "",
        exclusions: existingTour.exclusions?.join("\n") || "",
        highlights: existingTour.highlights?.join("\n") || "",
      });
    }
  }, [existingTour, form]);

  const addItineraryDay = () => {
    setDayWiseItinerary((days) => [
      ...days,
      { day: days.length + 1, title: "", description: "" },
    ]);
  };

  const updateItineraryDay = (index: number, patch: Partial<ItineraryDay>) => {
    setDayWiseItinerary((days) =>
      days.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  };

  const removeItineraryDay = (index: number) => {
    setDayWiseItinerary((days) =>
      days.filter((_, i) => i !== index).map((d, i) => ({ ...d, day: i + 1 }))
    );
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingPdf(true);
      const url = await uploadFile(file);
      setItineraryPdfUrl(url);
    } catch (error) {
      console.error("Failed to upload itinerary PDF:", error);
      alert("Failed to upload the itinerary PDF. Please try again.");
    } finally {
      setIsUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: TourFormValues) => {
    try {
      const tourData: TourPackage = {
        id: isEditMode ? id! : crypto.randomUUID(),
        ...values,
        itinerary: values.itinerary || "",
        images,
        day_wise_itinerary: dayWiseItinerary
          .filter((d) => d.title.trim() || d.description.trim())
          .map((d, i) => ({ ...d, day: i + 1 })),
        itinerary_pdf_url: itineraryPdfUrl,
        inclusions: (values.inclusions || "")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        exclusions: (values.exclusions || "")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        highlights: (values.highlights || "")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      };

      if (isEditMode) {
        await updateTour(id!, tourData);
      } else {
        await addTour(tourData);
      }
      navigate("/tours");
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "Unable to save package. Please try again.",
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const url = await uploadTourImage(file);
      setImages([...images, url]);
    } catch (error) {
      console.error("Failed to upload image:", error);
      alert("Failed to upload image. Please try again with a smaller image.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  if (id && !existingTour) return <div className="py-16 text-center space-y-4"><p>{loaded ? "Package not found" : "Loading package…"}</p><Button onClick={() => navigate("/tours")}>Back to packages</Button></div>;

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto pb-12">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/tours")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {isEditMode ? "Edit Tour Package" : "Create New Package"}
          </h2>
          <p className="text-slate-500 text-sm">
            Fill in the details for the tour package.
          </p>
        </div>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit as any)}
          className="space-y-8 bg-white p-6 rounded-lg border border-slate-100 shadow-sm"
        >
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" {...form.register("price_on_request")} />Price on request — an advisor prepares the quote</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control as any}
              name="title"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Package Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Bali Paradise Escape"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control as any}
              name="destination"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Destination</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Indonesia" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control as any}
              name="duration"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Duration (Days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        field.onChange(+e.target.value)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control as any}
              name="price"
              render={({ field }: { field: any }) => (
                <FormItem>
                  <FormLabel>Price (€)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      {...field}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        field.onChange(+e.target.value)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control as any}
            name="description"
            render={({ field }: { field: any }) => (
              <FormItem>
                <FormLabel>Short Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Brief overview of the tour..."
                    className="resize-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control as any}
            name="highlights"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Package highlights (one per line)</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="e.g. Private desert safari&#10;5-star beachfront resort" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control as any}
            name="itinerary"
            render={({ field }: { field: any }) => (
              <FormItem>
                <FormLabel>Overview / long-form itinerary (rich text)</FormLabel>
                <FormControl>
                  <RichTextEditor
                    content={field.value || ""}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <section className="space-y-4 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Day-wise itinerary</h3>
                <p className="text-sm text-slate-500">
                  Used for the WhatsApp full-itinerary sharing flow and the package brief. Leave empty to rely on the overview above.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItineraryDay} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add day
              </Button>
            </div>
            <div className="space-y-3">
              {dayWiseItinerary.map((entry, index) => (
                <div key={index} className="flex gap-3 items-start p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                  <div className="flex items-center gap-2 pt-2.5 text-slate-400 flex-shrink-0">
                    <GripVertical className="h-4 w-4" />
                    <span className="text-xs font-black uppercase tracking-wide text-slate-500 w-14">Day {entry.day}</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Title, e.g. Arrival & city tour"
                      value={entry.title}
                      onChange={(e) => updateItineraryDay(index, { title: e.target.value })}
                    />
                    <Textarea
                      rows={2}
                      placeholder="What happens this day..."
                      value={entry.description}
                      onChange={(e) => updateItineraryDay(index, { description: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 hover:text-red-600 flex-shrink-0"
                    onClick={() => removeItineraryDay(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {dayWiseItinerary.length === 0 && (
                <p className="text-sm text-slate-400 italic">No day-wise entries yet.</p>
              )}
            </div>
          </section>

          <section className="space-y-3 border-t pt-6">
            <FormLabel>Itinerary PDF</FormLabel>
            <input type="file" accept="application/pdf" className="hidden" ref={pdfInputRef} onChange={handlePdfUpload} />
            {itineraryPdfUrl ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <FileText className="h-5 w-5 text-slate-400 flex-shrink-0" />
                <a href={itineraryPdfUrl} target="_blank" rel="noreferrer" className="text-sm text-[#33A894] font-semibold truncate flex-1 hover:underline">
                  View current itinerary PDF
                </a>
                <Button type="button" variant="ghost" size="icon" onClick={() => setItineraryPdfUrl(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full h-16 border-dashed border-2 flex gap-2 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300"
                onClick={() => pdfInputRef.current?.click()}
                disabled={isUploadingPdf}
              >
                {isUploadingPdf ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <Upload className="h-5 w-5 text-slate-400" />}
                <span className="text-slate-500 font-medium">{isUploadingPdf ? "Uploading..." : "Upload itinerary PDF"}</span>
              </Button>
            )}
          </section>

          <section className="space-y-4 border-t pt-6">
            <h3 className="text-lg font-semibold">Travel details</h3>
            <p className="text-sm text-slate-500">
              Only enter confirmed details. Leave anything unconfirmed blank.
            </p>
            <div className="grid gap-5 md:grid-cols-2">
              {(
                [
                  ["departure_city", "Departure city"],
                  ["availability", "Departure dates / availability"],
                  ["accommodation", "Accommodation / room type"],
                  ["meals", "Meal plan"],
                  ["transport", "Transport / transfers"],
                  ["cancellation_policy", "Cancellation & booking terms"],
                  ["inclusions", "Included (one item per line)"],
                  ["exclusions", "Not included (one item per line)"],
                ] as const
              ).map(([name, label]) => (
                <FormField
                  key={name}
                  control={form.control as any}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </section>
          <div className="space-y-3">
            <FormLabel>Images</FormLabel>
            <div className="flex flex-col gap-4">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full h-24 border-dashed border-2 flex flex-col gap-2 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                ) : (
                  <Upload className="h-6 w-6 text-slate-400" />
                )}
                <span className="text-slate-500 font-medium">
                  {isUploading ? "Uploading..." : "Choose from system library"}
                </span>
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-4">
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className="relative group aspect-video rounded-md overflow-hidden bg-slate-100 border border-slate-200"
                >
                  <img
                    src={img}
                    alt={`Preview ${idx}`}
                    className="w-full h-full object-cover"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeImage(idx)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <FormField
            control={form.control as any}
            name="status"
            render={({ field }: { field: any }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="active">Active — visible to customers &amp; the WhatsApp bot</SelectItem>
                    <SelectItem value="draft">Draft — internal only, never recommended</SelectItem>
                    <SelectItem value="inactive">Inactive — retired</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.formState.errors.root && (
            <p role="alert" className="text-red-600">
              {form.formState.errors.root.message}
            </p>
          )}
          <div className="flex justify-end gap-4 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/tours")}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || isUploading}
              className="bg-[#33A894] hover:bg-[#2c9180] text-white"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Package
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
