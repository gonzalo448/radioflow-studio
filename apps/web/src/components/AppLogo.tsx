type Props = {
 /** header = barra superior; auth = login/configuración; sm = compacto */
 variant?: "header" | "auth" | "sm";
 className?: string;
};

export function AppLogo({ variant = "header", className = "" }: Props) {
 return (
 <img
 src="./radioflow-logo.png"
 alt="RadioFlow Studio"
 className={`app-logo app-logo--${variant}${className ? ` ${className}` : ""}`}
 decoding="async"
 draggable={false}
 />
 );
}
