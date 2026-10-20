'use client';

import React, { useState } from 'react';
import { Mail, AlertCircle, Loader2, ArrowLeft, CheckCircle2, Users, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { requestPasswordReset } from '@/app/actions/auth';

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData(e.currentTarget);
      const result = await requestPasswordReset(formData);

      if (result?.error) {
        setError(result.error);
      } else if (result?.success) {
        setIsSubmitted(true);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
            Intérpretes RD
          </h1>
          <p className="text-gray-500 text-sm mt-2 uppercase tracking-widest">Secure Access Recovery</p>
        </div>

        <div className="glass rounded-3xl p-8 border border-white/10">
          {isSubmitted ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/20">
                <CheckCircle2 size={32} className="text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-4">Check your email</h2>
              <p className="text-gray-400 mb-8">
                We&apos;ve sent a password reset link to your email address. Please check your inbox and follow the instructions.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                <ArrowLeft size={16} />
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <div className="flex bg-white/5 rounded-xl p-1 mb-8">
                <button
                  type="button"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all bg-blue-500/20 text-blue-400 shadow-sm"
                >
                  <Users size={16} />
                  Interpreter
                </button>
                <button
                  type="button"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all text-gray-500 hover:text-gray-300 hover:bg-white/5"
                >
                  <ShieldAlert size={16} />
                  Administrator
                </button>
              </div>

              <h2 className="text-xl font-bold text-white mb-2">Reset Password</h2>
              <p className="text-gray-400 text-sm mb-8">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>

              {error && (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 mb-6">
                  <AlertCircle size={18} className="text-red-400 shrink-0" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      placeholder="usuario@interpretesrd.com"
                      className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  <ArrowLeft size={16} />
                  Back to login
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-8">
          © 2026 Intérpretes RD. Secure Enterprise Access.
        </p>
      </div>
    </div>
  );
}
