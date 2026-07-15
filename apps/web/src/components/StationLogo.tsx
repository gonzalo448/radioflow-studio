import { resolveStationLogoSrc } from "../lib/station-logo-url";

type Props = {
 logoUrl: string | null;
 stationName?: string | null;
 className?: string;
 cacheVersion?: number;
};

/** Logo de la emisora (mismo tamaño que el logo de la app en la barra). */
export function StationLogo({ logoUrl, stationName, className = "", cacheVersion = 0 }: Props) {
 let src = resolveStationLogoSrc(logoUrl);
 if (src && cacheVersion > 0) {
 src += `${src.includes("?") ? "&" : "?"}v=${cacheVersion}`;
 }
 if (!src) return null;

 return (
 <img
 src={src}
 alt={stationName ? `Logo de ${stationName}` : "Logo de la emisora"}
 className={`station-logo station-logo--header${className ? ` ${className}` : ""}`}
 decoding="async"
 draggable={false}
 />
 );
}
