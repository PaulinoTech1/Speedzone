"use client"

/* eslint-disable @next/next/no-img-element */
import { useState } from "react"

interface VehiclePhotoCarouselProps {
  images: string[]
  alt: string
}

export function VehiclePhotoCarousel({ images, alt }: VehiclePhotoCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const hasMultipleImages = images.length > 1
  const activeImage = images[activeIndex]

  if (!activeImage) {
    return <div className="inventory-photo-frame" aria-label={`${alt} photo unavailable`} />
  }

  return (
    <div className="inventory-photo-frame">
      <img className="inventory-photo" src={activeImage} alt={`${alt} photo ${activeIndex + 1} of ${images.length}`} />
      {hasMultipleImages ? (
        <>
          <button
            type="button"
            className="inventory-photo-control inventory-photo-control-prev"
            onClick={() => setActiveIndex((index) => (index - 1 + images.length) % images.length)}
            aria-label="Show previous vehicle photo"
          >
            ‹
          </button>
          <button
            type="button"
            className="inventory-photo-control inventory-photo-control-next"
            onClick={() => setActiveIndex((index) => (index + 1) % images.length)}
            aria-label="Show next vehicle photo"
          >
            ›
          </button>
          <span className="inventory-photo-count" aria-live="polite">
            {activeIndex + 1} / {images.length}
          </span>
        </>
      ) : null}
    </div>
  )
}
