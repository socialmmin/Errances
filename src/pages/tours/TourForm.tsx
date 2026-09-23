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
import { ArrowLeft, Save, X, Upload, Loader2 } from "lucide-react";
import type { TourPackage } from "@/types";
import { uploadTourImage } from "@/lib/api";
import { useRef } from "react";

const tourSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  destination: z.string().min(2, "Destination is required"),
  duration: z.coerce.number().min(1, "Duration must be at least 1 day"),
  price_on_request: z.boolean(),
  price: z.coerce.number().min(0, "Price must be positive"),
  description: z.string().min(10, "Description needs to be longer"),
  status: z.enum(["active", "inactive"]),
  departure_city: z.string().optional(),
  availability: z.string().optional(),
  accommodation: z.string().optional(),
  meals: z.string().optional(),
  transport: z.string().optional(),
  cancellation_policy: z.string().optional(),
  inclusions: z.string().optional(),
  exclusions: z.string().optional(),
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
    },
  });

  useEffect(() => {
    if (existingTour) {
      setImages(existingTour.images || []);
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
      });
    }
  }, [existingTour, form]);

  const onSubmit = async (values: TourFormValues) => {
    try {
      const tourData: TourPackage = {
        id: isEditMode ? id! : crypto.randomUUID(),
        ...values,
        itinerary: values.itinerary || "",
        images,
        inclusions: (values.inclusions || "")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        exclusions: (values.exclusions || "")
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
            name="itinerary"
            render={({ field }: { field: any }) => (
              <FormItem>
                <FormLabel>Detailed Itinerary</FormLabel>
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
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
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
