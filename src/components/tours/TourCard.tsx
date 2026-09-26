import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, MapPin, Euro, Calendar, Trash2 } from 'lucide-react';
import type { TourPackage } from '@/types';
import { cn } from '@/lib/utils';

interface TourCardProps {
    tour: TourPackage;
    isAdmin?: boolean;
    onEdit?: (tour: TourPackage) => void;
    onDelete?: (id: string) => void;
}

export function TourCard({ tour, isAdmin = false, onEdit, onDelete }: TourCardProps) {
    return (
        <Card className="overflow-hidden border-none bg-white/70 backdrop-blur-sm shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col h-full rounded-3xl ring-1 ring-slate-200/50">
            <div className="relative h-56 overflow-hidden bg-slate-100">
                {tour.images?.[0] ? <img
                    src={tour.images?.[0]}
                    alt={tour.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                /> : <div className="h-full flex items-center justify-center text-slate-400"><MapPin className="h-10 w-10" /></div>}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute top-3 right-3">
                    <Badge className={cn(
                        "font-black text-[10px] px-3 py-1 rounded-lg uppercase tracking-widest shadow-lg backdrop-blur-md border-none",
                        tour.status === 'active' ? 'bg-emerald-500/90 text-white' : tour.status === 'draft' ? 'bg-amber-500/90 text-white' : 'bg-slate-500/90 text-white'
                    )}>
                        {tour.status}
                    </Badge>
                </div>
                <div className="absolute bottom-3 left-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                    <div className="flex items-center text-white font-black text-xl">
                        {!tour.price_on_request && <Euro className="w-5 h-5" />}
                        {tour.price_on_request ? 'Quote on request' : Number(tour.price).toLocaleString()}
                    </div>
                </div>
            </div>
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                        <CardTitle className="line-clamp-1 text-lg font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">
                            {tour.title}
                        </CardTitle>
                        <div className="flex items-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <MapPin className="w-3 h-3 mr-1 text-rose-500" />
                            {tour.destination}
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="flex-grow pb-4">
                <CardDescription className="line-clamp-2 text-xs font-medium text-slate-500 mb-4 leading-relaxed">
                    {tour.description}
                </CardDescription>
                <p className="text-lg font-semibold text-slate-900 mb-3">{tour.price_on_request ? "Quote on request" : `€${Number(tour.price).toLocaleString()}`} <span className="text-xs font-normal text-slate-500">{!tour.price_on_request && "per person"}</span></p>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                        <Clock className="w-3 h-3 mr-1.5 text-indigo-500" />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{tour.duration_note ? "Confirm duration" : `${tour.duration} Days`}</span>
                    </div>
                    <div className="flex items-center bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                        <Calendar className="w-3 h-3 mr-1.5 text-emerald-500" />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{tour.availability || 'Dates to confirm'}</span>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="pt-0 pb-6 px-6">
                <div className="flex flex-wrap gap-2 w-full">
                    <Button asChild variant="outline" className="w-full"><Link to={`/tours/${tour.id}`}>View details</Link></Button>
                    {isAdmin && (
                        <>
                            <Button
                                className="flex-1 h-10 rounded-xl bg-[#33A894] hover:bg-[#2c9180] text-white font-bold shadow-md shadow-[#33A894]/20 transition-all"
                                onClick={() => onEdit?.(tour)}
                            >
                                Edit Package
                            </Button>
                            <Button
                                aria-label={`Delete ${tour.title}`}
                                variant="ghost"
                                className="h-10 w-10 p-0 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100"
                                onClick={() => onDelete?.(tour.id)}
                            >
                                <Trash2 className="h-4 h-4" />
                            </Button>
                        </>
                    )}
                </div>
            </CardFooter>
        </Card>
    );
}
