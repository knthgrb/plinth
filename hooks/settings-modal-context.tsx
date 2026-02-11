"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type SettingsSection = 
  | "account"
  | "organizations"
  | "payroll"
  | "leave-types"
  | "departments"
  | "holidays";

interface SettingsModalContextType {
  isOpen: boolean;
  openModal: (section?: SettingsSection) => void;
  closeModal: () => void;
  initialSection: SettingsSection;
}

const SettingsModalContext = createContext<SettingsModalContextType | undefined>(undefined);

export function SettingsModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialSection, setInitialSection] = useState<SettingsSection>("account");

  const openModal = (section: SettingsSection = "account") => {
    setInitialSection(section);
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
  };

  return (
    <SettingsModalContext.Provider value={{ isOpen, openModal, closeModal, initialSection }}>
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  const context = useContext(SettingsModalContext);
  if (context === undefined) {
    throw new Error("useSettingsModal must be used within a SettingsModalProvider");
  }
  return context;
}
