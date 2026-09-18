from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from app.dependencies import get_db, get_current_admin
from app.models.client import Client
from app.schemas.client import ClientCreate, ClientUpdate, ClientResponse, ClientListItem

router = APIRouter()


@router.get("/clients", response_model=List[ClientListItem])
def list_clients(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(Client).order_by(Client.created_at.desc()).all()


@router.post("/clients", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(body: ClientCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    existing = db.query(Client).filter(Client.client_id == body.client_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="client_id already exists")
    client = Client(**body.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.get("/clients/{client_uuid}", response_model=ClientResponse)
def get_client(client_uuid: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Not found")
    return client


@router.put("/clients/{client_uuid}", response_model=ClientResponse)
def update_client(client_uuid: uuid.UUID, body: ClientUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    return client


@router.delete("/clients/{client_uuid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(client_uuid: uuid.UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    client = db.query(Client).filter(Client.id == client_uuid).first()
    if not client:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(client)
    db.commit()
