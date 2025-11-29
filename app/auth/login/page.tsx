import { LoginForm } from "@/components/auth/LoginForm";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function Page() {
  return (
    <div className="min-h-svh w-full bg-background relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 -left-40 w-[600px] h-[600px] bg-primary/40 rounded-full blur-[150px] animate-pulse" />
        <div className="absolute bottom-0 -right-40 w-[500px] h-[500px] bg-blue-500/30 rounded-full blur-[150px] animate-pulse delay-700" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/20 rounded-full blur-[200px] animate-pulse delay-1000" />
      </div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      {/* Floating shapes */}
      <div className="absolute top-20 left-[15%] w-20 h-20 border border-primary/20 rounded-full animate-bounce delay-100" />
      <div className="absolute top-40 right-[20%] w-12 h-12 border border-primary/30 rotate-45 animate-pulse" />
      <div className="absolute bottom-32 left-[25%] w-16 h-16 border border-primary/20 rounded-lg rotate-12 animate-bounce delay-300" />
      <div className="absolute bottom-40 right-[15%] w-8 h-8 bg-primary/20 rounded-full animate-pulse delay-500" />

      {/* Back to home */}
      <Link
        href="/"
        className="absolute top-6 left-6 z-20 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
      >
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
        Back to home
      </Link>

      {/* Main content */}
      <div className="relative z-10 flex min-h-svh">
        {/* Left - Branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 xl:px-24">
          <div className="max-w-lg">
            <div className="flex items-center gap-4 mb-12">
              <Image
                src="/logo-notext-nobg.svg"
                alt="Mintonix"
                width={56}
                height={56}
              />
              <span className="text-2xl font-bold">Mintonix</span>
            </div>

            <h1 className="text-5xl xl:text-6xl font-bold leading-tight mb-6">
              Elevate your
              <span className="block text-primary">badminton game</span>
            </h1>

            <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
              AI-powered video analysis that identifies weaknesses, tracks your progress, and gives you personalized insights to dominate the court.
            </p>

            {/* Testimonial */}
            <div className="relative">
              <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-primary to-primary/0 rounded-full" />
              <blockquote className="pl-6">
                <p className="text-foreground/90 mb-4 leading-relaxed">
                  &quot;Within 3 weeks of using Mintonix, I identified flaws in my footwork I&apos;d had for years. My coach was impressed with how quickly I improved.&quot;
                </p>
                <footer className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-sm font-bold text-primary-foreground">
                    SC
                  </div>
                  <div>
                    <div className="font-medium">Sarah Chen</div>
                    <div className="text-sm text-muted-foreground">Competitive Player, Malaysia</div>
                  </div>
                </footer>
              </blockquote>
            </div>
          </div>
        </div>

        {/* Right - Form */}
        <div className="flex-1 flex items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-sm">
            {/* Mobile branding */}
            <div className="flex flex-col items-center mb-10 lg:hidden">
              <Image
                src="/logo-notext-nobg.svg"
                alt="Mintonix"
                width={56}
                height={56}
                className="mb-4"
              />
              <h1 className="text-2xl font-bold">Welcome back</h1>
              <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
            </div>

            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
