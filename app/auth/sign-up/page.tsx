import { SignUpForm } from "@/components/auth/SignUpForm";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

export default function Page() {
  return (
    <div className="min-h-svh w-full bg-background relative overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 right-0 w-[700px] h-[700px] bg-primary/30 rounded-full blur-[150px] animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-violet-500/20 rounded-full blur-[150px] animate-pulse delay-500" />
        <div className="absolute top-1/3 left-1/3 w-[600px] h-[600px] bg-cyan-500/15 rounded-full blur-[180px] animate-pulse delay-1000" />
      </div>

      {/* Diagonal lines pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `repeating-linear-gradient(45deg, currentColor 0, currentColor 1px, transparent 0, transparent 50%)`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Floating elements */}
      <div className="absolute top-32 right-[20%] w-24 h-24 border border-primary/20 rounded-2xl rotate-12 animate-pulse" />
      <div className="absolute top-48 left-[10%] w-16 h-16 border border-primary/30 rounded-full animate-bounce delay-200" />
      <div className="absolute bottom-24 right-[30%] w-12 h-12 bg-primary/10 rounded-lg rotate-45 animate-pulse delay-700" />
      <div className="absolute bottom-48 left-[20%] w-20 h-20 border border-primary/15 rounded-full animate-bounce delay-500" />

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
              Start your journey to
              <span className="block text-primary">mastery</span>
            </h1>

            <p className="text-lg text-muted-foreground mb-12 leading-relaxed">
              Join hundreds of players using AI to transform their game. Get started in minutes with our free tier.
            </p>

            {/* Benefits list */}
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="font-medium mb-1">Instant video analysis</div>
                  <div className="text-sm text-muted-foreground">Upload any match footage and get AI insights within minutes</div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="font-medium mb-1">Personalized feedback</div>
                  <div className="text-sm text-muted-foreground">Get specific tips tailored to your playing style and weaknesses</div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="font-medium mb-1">Progress tracking</div>
                  <div className="text-sm text-muted-foreground">Watch your stats improve over time with detailed analytics</div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="font-medium mb-1">Free to start</div>
                  <div className="text-sm text-muted-foreground">No credit card required. Upgrade anytime for more features</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right - Form */}
        <div className="flex-1 flex items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-sm">
            {/* Mobile branding */}
            <div className="flex flex-col items-center mb-8 lg:hidden">
              <Image
                src="/logo-notext-nobg.svg"
                alt="Mintonix"
                width={56}
                height={56}
                className="mb-4"
              />
              <h1 className="text-2xl font-bold">Create account</h1>
              <p className="text-sm text-muted-foreground mt-1">Start improving today</p>
            </div>

            <SignUpForm />
          </div>
        </div>
      </div>
    </div>
  );
}
