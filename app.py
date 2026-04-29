import os
import datetime
from functools import wraps
from flask import Flask, request, jsonify, g
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import jwt
import bcrypt

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Configuration
app.config['SECRET_KEY'] = os.environ.get('JWT_SECRET', 'ncs_super_secret_change_this')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///ncs_flask.sqlite'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# --- Models ---

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='user')
    preferred_domain = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    last_login = db.Column(db.DateTime)

class LoginHistory(db.Model):
    __tablename__ = 'login_history'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    username = db.Column(db.String(80), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), nullable=False)
    ip = db.Column(db.String(45))
    user_agent = db.Column(db.Text)
    domain = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class ApiLog(db.Model):
    __tablename__ = 'api_logs'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    method = db.Column(db.String(10), nullable=False)
    path = db.Column(db.String(200), nullable=False)
    status_code = db.Column(db.Integer, nullable=False)
    ip = db.Column(db.String(45))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Job(db.Model):
    __tablename__ = 'jobs'
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title = db.Column(db.String(120), nullable=False)
    company = db.Column(db.String(120), nullable=False)
    location = db.Column(db.String(120), default='India')
    type = db.Column(db.String(50), default='Full Time')
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Setting(db.Model):
    __tablename__ = 'settings'
    key = db.Column(db.String(50), primary_key=True)
    value = db.Column(db.String(255), nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

# --- Database Initialization ---

def init_db():
    with app.app_context():
        db.create_all()

        # Seed Admin User
        admin_user = User.query.filter_by(username='admin').first()
        if not admin_user:
            hashed = bcrypt.hashpw('admin@123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            admin = User(username='admin', password_hash=hashed, role='admin', preferred_domain='Administration')
            db.session.add(admin)

        # Seed Demo User
        demo_user = User.query.filter_by(username='manoj').first()
        if not demo_user:
            hashed = bcrypt.hashpw('manoj123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            demo = User(username='manoj', password_hash=hashed, role='user', preferred_domain='Computer Science & Engineering (CSE)')
            db.session.add(demo)

        # Seed Jobs
        if Job.query.count() == 0:
            jobs = [
                Job(title="Frontend Developer", company="TCS", location="Chennai", type="Full Time"),
                Job(title="Backend Engineer", company="Zoho", location="Chennai", type="Full Time"),
                Job(title="Data Analyst Intern", company="Infosys", location="Bangalore", type="Internship")
            ]
            db.session.bulk_save_objects(jobs)

        # Seed Settings
        if not Setting.query.filter_by(key='maintenance_mode').first():
            db.session.add(Setting(key='maintenance_mode', value='off'))
        if not Setting.query.filter_by(key='theme_override').first():
            db.session.add(Setting(key='theme_override', value='auto'))

        db.session.commit()
        print("Database initialized successfully.")

# --- Middleware / Decorators ---

def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({"message": "Missing token"}), 401
        
        token = auth_header.split(" ")[1]
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            g.user = data
        except Exception:
            return jsonify({"message": "Invalid token"}), 401
        
        return f(*args, **kwargs)
    return decorated

def admin_only(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'user') or g.user.get('role') != 'admin':
            return jsonify({"message": "Admin access required"}), 403
        return f(*args, **kwargs)
    return decorated

@app.after_request
def log_request(response):
    if request.path.startswith('/api'):
        try:
            log = ApiLog(
                method=request.method,
                path=request.path,
                status_code=response.status_code,
                ip=request.remote_addr
            )
            db.session.add(log)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"Failed to log API request: {e}")
    return response

# --- Routes ---

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username')
    password = data.get('password')
    domain = data.get('domain')
    
    if not username or not password:
        return jsonify({"message": "Username and password are required."}), 400

    username = username.strip()
    user = User.query.filter_by(username=username).first()

    ip_addr = request.remote_addr or 'unknown'
    user_agent = request.headers.get('User-Agent', 'unknown')

    if not user or not bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
        history = LoginHistory(
            user_id=None, username=username, role='unknown', status='failed',
            ip=ip_addr, user_agent=user_agent, domain=domain
        )
        db.session.add(history)
        db.session.commit()
        return jsonify({"message": "Invalid credentials."}), 401

    user.preferred_domain = domain or user.preferred_domain
    user.last_login = datetime.datetime.utcnow()

    history = LoginHistory(
        user_id=user.id, username=user.username, role=user.role, status='success',
        ip=ip_addr, user_agent=user_agent, domain=domain or user.preferred_domain
    )
    db.session.add(history)
    db.session.commit()

    token = jwt.encode({
        'id': user.id,
        'username': user.username,
        'role': user.role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=12)
    }, app.config['SECRET_KEY'], algorithm="HS256")

    return jsonify({
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role
        }
    })

@app.route('/api/admin/overview', methods=['GET'])
@auth_required
@admin_only
def admin_overview():
    users_count = User.query.count()
    successful_logins = LoginHistory.query.filter_by(status='success').count()
    jobs_count = Job.query.count()
    api_calls = ApiLog.query.count()
    
    return jsonify({
        "totalUsers": users_count,
        "successfulLogins": successful_logins,
        "totalJobs": jobs_count,
        "apiCalls": api_calls
    })

@app.route('/api/admin/jobs', methods=['GET'])
@auth_required
@admin_only
def get_jobs():
    jobs = Job.query.order_by(Job.id.desc()).all()
    return jsonify([{
        "id": j.id, "title": j.title, "company": j.company, 
        "location": j.location, "type": j.type, "created_at": j.created_at.isoformat()
    } for j in jobs])

@app.route('/api/admin/jobs', methods=['POST'])
@auth_required
@admin_only
def create_job():
    data = request.json or {}
    if not data.get('title') or not data.get('company'):
        return jsonify({"message": "title and company are required"}), 400
    
    job = Job(
        title=data['title'],
        company=data['company'],
        location=data.get('location', 'India'),
        type=data.get('type', 'Full Time')
    )
    db.session.add(job)
    db.session.commit()
    
    return jsonify({
        "id": job.id, "title": job.title, "company": job.company, 
        "location": job.location, "type": job.type
    }), 201

@app.route('/api/admin/users', methods=['GET'])
@auth_required
@admin_only
def get_users():
    users = User.query.order_by(User.id.desc()).all()
    return jsonify([{
        "id": u.id, "username": u.username, "role": u.role,
        "preferred_domain": u.preferred_domain, 
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None
    } for u in users])

# Serve static files for frontend routing fallback
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return app.send_static_file(path)
    return app.send_static_file('index.html')

if __name__ == '__main__':
    init_db()
    print("Starting Flask server on port 5000...")
    app.run(port=5000, debug=True)
