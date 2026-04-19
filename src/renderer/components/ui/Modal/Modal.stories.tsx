/**
 * Modal Component Stories
 */

import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './Modal';
import { Button } from '../Button/Button';
import { Input } from '../Input/Input';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Composant Modal accessible avec gestion du focus trap, animations fluides et support du dark mode. Permet de créer des boîtes de dialogue, formulaires et confirmations.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'État ouvert/fermé du modal',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl'],
      description: 'Taille du modal',
    },
    closeOnBackdrop: {
      control: 'boolean',
      description: 'Fermer en cliquant sur le backdrop',
    },
    closeOnEsc: {
      control: 'boolean',
      description: 'Fermer avec la touche ESC',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

// Wrapper component pour gérer l'état
const ModalWrapper = ({ children, ...props }: any) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Ouvrir le modal</Button>
      <Modal {...props} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        {children}
      </Modal>
    </>
  );
};

// Basic Modal
export const Basic: Story = {
  render: (args) => (
    <ModalWrapper {...args}>
      <ModalHeader>Modal de base</ModalHeader>
      <ModalBody>
        <p>Ceci est un modal de base avec un titre et du contenu simple.</p>
      </ModalBody>
    </ModalWrapper>
  ),
};

// Modal with Header, Body and Footer
export const WithHeaderBodyFooter: Story = {
  render: () => (
    <ModalWrapper>
      <ModalHeader>Titre du modal</ModalHeader>
      <ModalBody>
        <p>
          Ce modal contient un header avec titre et bouton de fermeture, un body avec du contenu
          scrollable, et un footer avec des actions.
        </p>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
          ut labore et dolore magna aliqua.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost">Annuler</Button>
        <Button variant="primary">Confirmer</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Small Size
export const SmallSize: Story = {
  render: () => (
    <ModalWrapper size="sm">
      <ModalHeader>Modal petit format</ModalHeader>
      <ModalBody>
        <p>Ce modal utilise la taille "sm" (400px max-width).</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">OK</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Medium Size (default)
export const MediumSize: Story = {
  render: () => (
    <ModalWrapper size="md">
      <ModalHeader>Modal taille moyenne</ModalHeader>
      <ModalBody>
        <p>Ce modal utilise la taille "md" (600px max-width) - taille par défaut.</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">OK</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Large Size
export const LargeSize: Story = {
  render: () => (
    <ModalWrapper size="lg">
      <ModalHeader>Modal grand format</ModalHeader>
      <ModalBody>
        <p>Ce modal utilise la taille "lg" (800px max-width).</p>
        <p>
          Il est parfait pour afficher du contenu plus volumineux comme des tableaux, des
          formulaires complexes ou des listes détaillées.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">OK</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Extra Large Size
export const ExtraLargeSize: Story = {
  render: () => (
    <ModalWrapper size="xl">
      <ModalHeader>Modal très grand format</ModalHeader>
      <ModalBody>
        <p>Ce modal utilise la taille "xl" (1000px max-width).</p>
        <p>
          Il est idéal pour afficher des interfaces complexes, des éditeurs ou des visualisations
          de données étendues.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">OK</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Confirmation Modal
export const ConfirmationModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          Supprimer l'élément
        </Button>
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} size="sm">
          <ModalHeader>Confirmer la suppression</ModalHeader>
          <ModalBody className="modal--confirmation">
            <p>Êtes-vous sûr de vouloir supprimer cet élément ?</p>
            <p>Cette action est irréversible.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                alert('Élément supprimé !');
                setIsOpen(false);
              }}
            >
              Supprimer
            </Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};

// Form Modal
export const FormModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      alert('Formulaire soumis !');
      setIsOpen(false);
    };

    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Ouvrir le formulaire</Button>
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} size="md">
          <ModalHeader>Créer un nouveau compte</ModalHeader>
          <ModalBody>
            <form id="user-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Input
                label="Nom d'utilisateur"
                placeholder="john.doe"
                required
                fullWidth
              />
              <Input
                label="Email"
                type="email"
                placeholder="john.doe@example.com"
                required
                fullWidth
              />
              <Input
                label="Mot de passe"
                type="password"
                placeholder="••••••••"
                required
                fullWidth
              />
              <Input
                label="Confirmation du mot de passe"
                type="password"
                placeholder="••••••••"
                required
                fullWidth
              />
            </form>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" form="user-form" variant="primary">
              Créer le compte
            </Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};

// Scrollable Content
export const ScrollableContent: Story = {
  render: () => (
    <ModalWrapper>
      <ModalHeader>Contenu scrollable</ModalHeader>
      <ModalBody>
        <h3>Lorem Ipsum</h3>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
          ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
          ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </p>
        <h3>Section 2</h3>
        <p>
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat
          nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
          deserunt mollit anim id est laborum.
        </p>
        <h3>Section 3</h3>
        <p>
          Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque
          laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi
          architecto beatae vitae dicta sunt explicabo.
        </p>
        <h3>Section 4</h3>
        <p>
          Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia
          consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.
        </p>
        <h3>Section 5</h3>
        <p>
          Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci
          velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam
          quaerat voluptatem.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">J'ai lu</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// No Backdrop Close
export const NoBackdropClose: Story = {
  render: () => (
    <ModalWrapper closeOnBackdrop={false}>
      <ModalHeader>Modal sans fermeture backdrop</ModalHeader>
      <ModalBody>
        <p>
          Ce modal ne peut pas être fermé en cliquant sur le backdrop. Vous devez utiliser le
          bouton de fermeture ou le bouton d'action.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">Fermer</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// No ESC Close
export const NoEscClose: Story = {
  render: () => (
    <ModalWrapper closeOnEsc={false}>
      <ModalHeader>Modal sans fermeture ESC</ModalHeader>
      <ModalBody>
        <p>
          Ce modal ne peut pas être fermé avec la touche ESC. Vous devez utiliser le bouton de
          fermeture ou le bouton d'action.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary">Fermer</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// Without Close Button
export const WithoutCloseButton: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Ouvrir le modal</Button>
        <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} size="sm">
          <ModalHeader showCloseButton={false}>Information importante</ModalHeader>
          <ModalBody>
            <p>Ce modal n'a pas de bouton de fermeture dans le header.</p>
            <p>Vous devez utiliser le bouton d'action ou la touche ESC.</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" onClick={() => setIsOpen(false)}>
              J'ai compris
            </Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};

// Custom Styled Modal
export const CustomStyled: Story = {
  render: () => (
    <ModalWrapper>
      <ModalHeader className="modal-header--no-border">Sans bordures</ModalHeader>
      <ModalBody className="modal-body--compact">
        <p>Ce modal utilise des classes utilitaires pour personnaliser l'apparence.</p>
        <p>Le header n'a pas de bordure et le body utilise un padding compact.</p>
      </ModalBody>
      <ModalFooter className="modal-footer--no-border">
        <Button variant="primary">OK</Button>
      </ModalFooter>
    </ModalWrapper>
  ),
};

// All Sizes Showcase
export const AllSizes: Story = {
  render: () => {
    const [openModal, setOpenModal] = useState<string | null>(null);

    return (
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <Button onClick={() => setOpenModal('sm')}>SM (400px)</Button>
        <Button onClick={() => setOpenModal('md')}>MD (600px)</Button>
        <Button onClick={() => setOpenModal('lg')}>LG (800px)</Button>
        <Button onClick={() => setOpenModal('xl')}>XL (1000px)</Button>

        <Modal isOpen={openModal === 'sm'} onClose={() => setOpenModal(null)} size="sm">
          <ModalHeader>Small Modal</ModalHeader>
          <ModalBody>
            <p>Max-width: 400px</p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setOpenModal(null)}>Fermer</Button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={openModal === 'md'} onClose={() => setOpenModal(null)} size="md">
          <ModalHeader>Medium Modal</ModalHeader>
          <ModalBody>
            <p>Max-width: 600px (par défaut)</p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setOpenModal(null)}>Fermer</Button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={openModal === 'lg'} onClose={() => setOpenModal(null)} size="lg">
          <ModalHeader>Large Modal</ModalHeader>
          <ModalBody>
            <p>Max-width: 800px</p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setOpenModal(null)}>Fermer</Button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={openModal === 'xl'} onClose={() => setOpenModal(null)} size="xl">
          <ModalHeader>Extra Large Modal</ModalHeader>
          <ModalBody>
            <p>Max-width: 1000px</p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setOpenModal(null)}>Fermer</Button>
          </ModalFooter>
        </Modal>
      </div>
    );
  },
};
