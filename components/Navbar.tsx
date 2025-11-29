"use client";

import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ClientAuthButton } from "@/components/auth/ClientAuthButton";
import { Menu, X } from "lucide-react";
import { useState } from "react";

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const navLinks = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Pricing", href: "/pricing" },
    { name: "Blog", href: "/blog" },
    { name: "About", href: "/about" },
  ];

  return (
    <nav className="w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16">
          {/* Logo */}
          <div className="flex items-center w-64">
            <Link href="/" className="flex items-center space-x-2">
              <Image
                src="/logo-notext-nobg.svg"
                alt="Mintonix Logo"
                width={64}
                height={64}
                className="w-6 h-6 object-contain"
                priority
              />
              <span className="font-bold text-xl text-foreground">Mintonix</span>
            </Link>
          </div>

          {/* Desktop Navigation - Centered */}
          <div className="hidden md:flex items-center justify-center flex-1 space-x-8">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="text-foreground/70 hover:text-foreground px-3 py-2 text-sm font-medium transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </div>

          {/* Desktop Auth */}
          <div className="hidden md:flex items-center justify-end w-64 space-x-4">
            <ClientAuthButton />
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMenuOpen && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-background border-b border-border/40 shadow-lg">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                className="text-foreground/70 hover:text-foreground block px-3 py-2 text-base font-medium transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                {link.name}
              </Link>
            ))}
            <div className="flex items-center space-x-4 px-3 py-2 pt-4 border-t border-border/40">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/auth/login">Sign In</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/auth/sign-up">Sign Up</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}