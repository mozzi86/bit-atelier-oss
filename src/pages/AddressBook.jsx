import { seitenWurzel } from "@core/lib/utils";
import React, { useState, useEffect } from "react";
import { bitApi } from "@core/api/bitApi";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Plus, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ContactForm from "../components/contacts/ContactForm";
import ContactList from "../components/contacts/ContactList";

export default function AddressBook() {
  const [contacts, setContacts] = useState([]);
  const [filteredContacts, setFilteredContacts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    let filtered = contacts.filter(contact =>
      contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contact.role?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredContacts(filtered);
  }, [contacts, searchTerm]);

  const loadContacts = async () => {
    setIsLoading(true);
    const data = await bitApi.entities.Contact.list("name");
    setContacts(data);
    setIsLoading(false);
  };

  const handleSubmit = async (contactData) => {
    if (editingContact) {
      await bitApi.entities.Contact.update(editingContact.id, contactData);
    } else {
      await bitApi.entities.Contact.create(contactData);
    }
    setShowForm(false);
    setEditingContact(null);
    loadContacts();
  };

  const handleEdit = (contact) => {
    setEditingContact(contact);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingContact(null);
  };

  return (
    <div className={seitenWurzel}>
      <div className="max-w-7xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4"
        >
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-emerald-700 to-teal-600 bg-clip-text text-transparent">
              Adressbuch
            </h1>
            <p className="text-slate-600 mt-1">Projektbeteiligte und Team-Kontakte verwalten</p>
          </div>
          <Button
            onClick={() => setShowForm(true)}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" />
            Neuer Kontakt
          </Button>
        </motion.div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <Input
            placeholder="Kontakte durchsuchen"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 border-slate-200 focus:border-emerald-500"
          />
        </div>
        
        <AnimatePresence>
          {showForm && (
            <ContactForm
              contact={editingContact}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
            />
          )}
        </AnimatePresence>

        <ContactList
          contacts={filteredContacts}
          isLoading={isLoading}
          onEdit={handleEdit}
        />
      </div>
    </div>
  );
}