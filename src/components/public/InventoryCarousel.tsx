"use client"

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { InventorySlide } from "@/lib/inventory-carousel";
import { vehiclePath } from "@/lib/vehicle-details";

/** Passive rotation interval. Paused on hover, focus, hidden tab, and reduced motion. */
const ROTATION_MS = 6000;

export function InventoryCarousel({ vehicles }: { vehicles: InventorySlide[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = vehicles.length;
  const goTo = useCallback(
    (index: number) => setActiveIndex(((index % count) + count) % count),
    [count],
  );
  const step = useCallback(
    (delta: number) => goTo(activeIndex + delta),
    [activeIndex, goTo],
  );

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") {
        setActiveIndex((index) => (index + 1) % count);
      }
    }, ROTATION_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [count, paused]);

  if (count === 0) return null;

  return (
    <div
      className="inventory-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Current inventory"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        // Focus moving between controls inside the carousel is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div className="inventory-carousel-slides">
        {vehicles.map((vehicle, index) => {
          const isActive = index === activeIndex;
          return (
            <article
              className="inventory-carousel-slide"
              key={vehicle.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${count}`}
              hidden={!isActive}
            >
              <Link
                className="inventory-carousel-link"
                href={vehiclePath(vehicle)}
                tabIndex={isActive ? 0 : -1}
              >
                <img
                  className="inventory-carousel-photo"
                  src={vehicle.photo}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                  loading={isActive ? "eager" : "lazy"}
                />
                <span className="inventory-carousel-caption">
                  <span className="inventory-carousel-title">
                    {vehicle.year} {vehicle.make} {vehicle.model}
                    {vehicle.trim ? ` ${vehicle.trim}` : ""}
                  </span>
                  <span className="inventory-carousel-meta">
                    ${vehicle.price.toLocaleString()} ·{" "}
                    {vehicle.mileage.toLocaleString()} miles
                  </span>
                  <span className="inventory-carousel-cta">
                    View details <span aria-hidden="true">→</span>
                  </span>
                </span>
              </Link>
            </article>
          );
        })}
      </div>

      {count > 1 ? (
        <div className="inventory-carousel-controls">
          <button
            type="button"
            className="inventory-carousel-control"
            onClick={() => step(-1)}
            aria-label="Show previous vehicle"
          >
            ‹
          </button>
          <span className="inventory-carousel-dots" aria-label="Choose vehicle">
            {vehicles.map((vehicle, index) => (
              <button
                key={vehicle.id}
                type="button"
                className="inventory-carousel-dot"
                aria-label={`Show ${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={() => goTo(index)}
              />
            ))}
          </span>
          <button
            type="button"
            className="inventory-carousel-control"
            onClick={() => step(1)}
            aria-label="Show next vehicle"
          >
            ›
          </button>
          <span className="inventory-carousel-count">
            {activeIndex + 1} / {count}
          </span>
        </div>
      ) : null}
    </div>
  );
}
