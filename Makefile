.PHONY: setup build up down stop restart logs clean help

help:
	@echo "Usage:"
	@echo "  make setup    - Setup configuration files and SSL certificates"
	@echo "  make build    - Build Docker images"
	@echo "  make up       - Start the application in Docker"
	@echo "  make stop     - Stop the application containers"
	@echo "  make down     - Stop and remove containers"
	@echo "  make restart  - Restart the application"
	@echo "  make logs     - Show logs"
	@echo "  make clean    - Remove Docker images and containers"

setup:
	@echo "Setting up configuration files..."
	@if [ ! -f backend/config.json ]; then cp backend/config.json.example backend/config.json; fi
	@if [ ! -f backend/users.json ]; then cp backend/users.json.example backend/users.json; fi
	@echo "Generating SSL certificates..."
	@mkdir -p certs
	@if [ ! -f certs/key.pem ]; then \
		openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"; \
	fi
	@echo "Setup complete."

build:
	docker compose build

up:
	docker compose up -d

stop:
	docker compose stop

down:
	docker compose down

restart:
	docker compose restart

logs:
	docker compose logs -f

clean:
	docker compose down --rmi all --volumes --remove-orphans
