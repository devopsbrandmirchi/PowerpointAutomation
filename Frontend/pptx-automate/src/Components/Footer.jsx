import React from 'react';

const Footer = () => {
  return (
    <footer className="shrink-0 border-t border-[rgba(194,198,209,0.2)] bg-surface-container-low px-6 py-3 md:px-8">
      <div className="flex flex-col items-center justify-between gap-2 text-center text-xs text-on-surface-variant sm:flex-row sm:text-left">
        <p>© {new Date().getFullYear()} Wheeler Agency · Internal use only</p>
        <p className="text-[11px] opacity-80">Wheeler Marketing Suite · Secure session</p>
      </div>
    </footer>
  );
};

export default Footer;
